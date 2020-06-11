let express = require('express');
let port = process.env.PORT || 5000;
let Client = require('pg').Client;
let async = require('async');

let opts = {connectionString: process.env.DATABASE_URL};

// when deploying on heroku, turn on ssl (but w/out auth verification)
if (!process.env.DATABASE_URL.includes('localhost'))
  opts.ssl = {rejectUnauthorized: false};

let conn = new Client(opts);
conn.connect();

let app = express();
app.use(express.static(`${__dirname}/public`));
app.use(express.json()); // Used to parse JSON bodies

app.get('/transactions', function(req, res) {
  conn.query('SELECT * FROM transaction', [], function(err, result) {
    if (err) return res.status(500).send(`SQL Error: ${err.message}`);

    // convert cents to dollars
    for (let row of result.rows)
      row.amount = row.amount / 100;
    
    res.json(result.rows);
  });
});

app.get('/splits', function(req, res) {
  conn.query('SELECT * FROM split', [], function(err, result) {
    if (err) return res.status(500).send(`SQL Error: ${err.message}`);
    res.json(result.rows);
  });
});

app.post('/transaction', function(req, res) {
  let trans = req.body;
  
  let params = [Math.round(trans.amount * 100), trans.description, trans.post_date];
  let sql;
  if (trans.id) {
    sql = `UPDATE transaction SET amount=$1, description=$2, post_date=$3 WHERE id=$4`;
    params.push(trans.id);
  }
  else {
    sql = `INSERT INTO transaction (amount, description, post_date) VALUES ($1, $2, $3)`;
  }

  conn.query(sql, params, function(err) {
    if (err) return res.status(500).send(`SQL Error: ${err.message}`);

    // delete all splits & re-insert every time, for simplicity
    deleteSplitsIfNecessary(trans.id, function(err) {
      if (err) return res.status(500).send(`Del Split SQL Error: ${err.message}`);

      async.each(trans.split, function(split, cb) {
        let split_sql = `INSERT INTO split (category_id, amount, trans_id) VALUES ($1, $2, $3)`;
        conn.query(split_sql, [split.category_id, split.amount, trans.id], cb);
      }, function(err) {
        if (err) return res.status(500).send(`Split SQL Error: ${err.message}`);
        res.end();
      });
    });
  });
});

function deleteSplitsIfNecessary(trans_id, cb) {
  if (!trans_id)
    return cb();

  conn.query(`DELETE FROM split WHERE trans_id = $1`, [trans_id], cb);
}

// create DB schema
let trans_sql = 'CREATE TABLE IF NOT EXISTS transaction (id SERIAL PRIMARY KEY, amount INTEGER, description VARCHAR(100), post_date CHAR(10))';
conn.query(trans_sql, [], function(err) {
  if (err) throw err;

  let split_sql = 'CREATE TABLE IF NOT EXISTS split (id SERIAL PRIMARY KEY, category_id INTEGER, amount INTEGER, trans_id INTEGER)';
  conn.query(split_sql, function(err) {
    if (err) throw err;

    app.listen(port, function() {
      console.log(`Listening on ${port}`);
    });
  });
});
