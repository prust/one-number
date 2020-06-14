let express = require('express');
let port = process.env.PORT || 5000;
let db_url = process.env.DATABASE_URL || 'postgres://peter-csnw:@localhost:5432/peter-csnw';
let Client = require('pg').Client;
let async = require('async');
let _ = require('underscore');

let opts = {connectionString: db_url};

// when deploying on heroku, turn on ssl (but w/out cert auth since it's internal to heroku's network)
if (!db_url.includes('localhost'))
  opts.ssl = {rejectUnauthorized: false};

let conn = new Client(opts);
conn.connect();

let app = express();
app.use(express.static(`${__dirname}/public`));
app.use(express.json()); // Used to parse JSON bodies

// meta
let plural_to_singular = {
  transactions: 'transaction',
  splits: 'split',
  categories: 'category',
  category_amounts: 'category_amount',
  rules: 'rule'
};

let tables = {
  transaction: [{name: 'id', defn: 'SERIAL PRIMARY KEY'}, {name: 'amount', defn: 'INTEGER'}, {name: 'description', defn: 'VARCHAR(100)'}, {name: 'post_date', defn: 'CHAR(10)'}],
  split: [{name: 'id', defn: 'SERIAL PRIMARY KEY'}, {name: 'category_id', defn: 'INTEGER'}, {name: 'amount', defn: 'INTEGER'}, {name: 'trans_id', defn: 'INTEGER'}],
  category: [{name: 'id', defn: 'SERIAL PRIMARY KEY'}, {name: 'name', defn: 'VARCHAR(50)'}, {name: 'num_months', defn: 'INTEGER'}],
  category_amount: [{name: 'id', defn: 'SERIAL PRIMARY KEY'}, {name: 'budget_amount', defn: 'INTEGER'}, {name: 'carryover_amount', defn: 'INTEGER'}, {name: 'start_date', defn: 'CHAR(10)'}],
  rule: [{name: 'id', defn: 'SERIAL PRIMARY KEY'}, {name: 'payee', defn: 'VARCHAR'}, {name: 'category_id', defn: 'INTEGER'}]
};

// getter JSON APIs
app.get(`/category_amounts/:start_month/:end_month`, function(req, res) {
  let params = [req.params.start_month, req.params.end_month];
  if (!params[0] || !params[1])
    return res.status(500).send(`Missing :start_month or :end_month`);

  let sql = `SELECT * FROM category_amount
    WHERE start_date > $1 AND start_date < $2`;
  conn.query(sql, params, function(err, result) {
    if (err) return res.status(500).send(`SQL Error: ${err.message}`);

    convertCentsToDollars(result.rows);
    res.json(result.rows);
   });
});

for (let entity of ['rules', 'categories']) {
  app.get(`/${entity}`, function(req, res) {
    let table = plural_to_singular[entity];
    conn.query(`SELECT * FROM ${table}`, [], function(err, result) {
      if (err) return res.status(500).send(`SQL Error: ${err.message}`);

      convertCentsToDollars(result.rows);
      res.json(result.rows);
     });
  });
}

app.get('/transactions/:start_month/:end_month', function(req, res) {
  let params = [req.params.start_month, req.params.end_month];
  if (!params[0] || !params[1])
    return res.status(500).send(`Missing :start_month or :end_month`);
  
  let trans_sql = `SELECT * FROM transaction
    WHERE post_date > $1 AND post_date < $2`;
  conn.query(trans_sql, params, function(err, result) {
    if (err) return res.status(500).send(`SQL Error: ${err.message}`);

    convertCentsToDollars(result.rows);

    var id_to_trans = {};
    for (let trans of result.rows) {
      trans.splits = [];
      id_to_trans[trans.id] = trans;
    }
    
    let split_sql = `SELECT * FROM split
      INNER JOIN transaction t ON split.trans_id = t.id
      WHERE t.post_date > $1 AND t.post_date < $2`;
    conn.query(split_sql, params, function(err, res_splits) {
      if (err) return res.status(500).send(`SQL Error: ${err.message}`);

      // add splits to transactions
      for (let split of res_splits.rows) {
        split.amount = split.amount / 100; // convert cents to dollars
        let trans = id_to_trans[split.trans_id];
        if (trans)
          trans.splits.push(split);
      }

      // return transactions
      res.json(result.rows);
    });
  });
});

app.post('/transactions', function(req, res) {
  let trans = req.body;
  
  convertDollarsToCents(trans);
  upsert('transaction', trans, function(err, result) {
    if (err) return res.status(500).send(`Upsert SQL error: ${err.message}`);
    trans.id = result.rows[0].id;

    // delete all splits & re-insert every time, for simplicity
    deleteSplitsIfNecessary(trans.id, function(err) {
      if (err) return res.status(500).send(`Del Split SQL Error: ${err.message}`);

      async.each(trans.splits, function(split, cb) {
        let split_sql = `INSERT INTO split (category_id, amount, trans_id) VALUES ($1, $2, $3)`;
        convertDollarsToCents(split);
        conn.query(split_sql, [split.category_id, split.amount, trans.id], cb);
      }, function(err) {
        if (err) return res.status(500).send(`Split SQL Error: ${err.message}`);
        res.json(trans);
      });
    });
  });
});

for (let entity of ['rules', 'categories', 'category_amounts']) {
  app.post(`/${entity}`, function(req, res) {
    let obj = req.body;
    
    if (entity == 'category_amounts') {
      _.defaults(obj, {
        budget_amount: 0,
        carryover_amount: 0
      });
    }

    convertDollarsToCents(obj);

    let table = plural_to_singular[entity];
    upsert(table, obj, function(err, result) {
      if (err) return res.status(500).send(`Upsert SQL error: ${err.message}`);
      obj.id = result.rows[0].id;
      res.json(obj);
    });
  });
}

// INSERT or UPDATE; we can't use pg's native upsert functionality ("ON CONFLICT UPDATE")
// b/c we're relying on the DB to generate the ID; we're not generating it ourselves
function upsert(table, obj, cb) {
  let colnames = _.pluck(tables[table], 'name');
  let non_id_cols = _.without(colnames, 'id');

  let params = non_id_cols.map(col => obj[col]);
  let sql;
  let col_ix = 1;
  if (obj.id) {
    sql = `UPDATE ${table} SET `;
    sql += non_id_cols.map(col => `${col}=$${col_ix++}`).join(', ');
    sql += ` WHERE id=$${col_ix}`;

    params.push(obj.id);
  }
  else {
    sql = `INSERT INTO ${table} (${non_id_cols.join(', ')})`;
    sql += ` VALUES (${non_id_cols.map(col => `$${col_ix++}`).join(', ')})`;
  }
  sql += ' RETURNING id'; // returns auto-generated ID for inserts, not critical for updates

  conn.query(sql, params, cb);
}

function deleteSplitsIfNecessary(trans_id, cb) {
  if (!trans_id)
    return cb();

  conn.query(`DELETE FROM split WHERE trans_id = $1`, [trans_id], cb);
}

// in postgres we're storing money in cents (INTEGER)
// but in the API we're using floats (but perhaps we shouldn't be...)
function convertCentsToDollars(rows) {
  for (let row of rows)
    for (let colname in row)
      if (colname.includes('amount'))
        row[colname] = row[colname] / 100;
}

function convertDollarsToCents(row) {
  for (let colname in row)
    if (colname.includes('amount'))
      row[colname] = Math.round(row[colname] * 100);
}

// create DB schema
async.each(Object.keys(tables), function(table, cb) {
  let cols = tables[table].map(col => `${col.name} ${col.defn}`);
  let trans_sql = `CREATE TABLE IF NOT EXISTS ${table} (${cols.join(', ')})`;
  conn.query(trans_sql, [], cb);
}, function(err) {
  app.listen(port, function() {
    console.log(`Listening on ${port}`);
  });
});
