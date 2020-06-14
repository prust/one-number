let filedrag = document.getElementById('filedrag');
filedrag.addEventListener("dragover", FileDragHover, false);
filedrag.addEventListener("dragleave", FileDragHover, false);
filedrag.addEventListener("drop", FileSelectHandler, false);

let year_sel = document.getElementById('year-sel');
let month_sel = document.getElementById('month-sel');
year_sel.value = new Date().getFullYear();
month_sel.value = pad2(new Date().getMonth() + 1);
year_sel.addEventListener('change', loadData);
month_sel.addEventListener('change', loadData);

let loaded_months = [];

let rule_lookup = {};
let report_div = document.getElementById('report');

// <select> change handler
report_div.addEventListener('change', async function(evt) {
  let el = evt.target;
  if (el.tagName != 'SELECT')
    return;

  // create a new category & add it to all SELECTs
  let category_id = el.value;
  if (category_id == '_new') {
    let new_cat_name = prompt('New Category Name:');
    if (new_cat_name) {
      let new_cat = await postEntity({name: new_cat_name}, '/categories');
      category_id = new_cat.id;
      categories.push(new_cat);
      
      // update the options on all SELECTs on the page, while retaining their value
      for (let sel of document.querySelectorAll('select.billing-cat')) {
        let val = sel.value;
        sel.innerHTML = getCategoryOptions();
        if (val)
          sel.value = val;
      }        
    }
    else {
      category_id = null;
    }
  }
  
  if (category_id)
    category_id = parseInt(category_id);

  // update transaction in the DB
  let trans_id = parseInt(el.getAttribute('data-trans-id'));
  if (isNaN(trans_id)) {
    console.log(el);
    throw new Error('NaN data-trans-id: ' + el.innerHTML);
  }
  let trans = _.findWhere(transactions, {id: trans_id});

  updateTransCategory(trans, category_id);

  // if there isn't a rule, create one
  if (category_id && !rule_lookup[trans.description]) {
    let rule = {description: trans.description, category_id: category_id};

    // update all other transactions in memory that match the rule & aren't yet categorized
    for (let t of transactions)
      if (t.description == rule.description)
        applyRule(t, rule);

    rule = await postEntity(rule, '/rules');
    rules.push(rule);
    rule_lookup[rule.description] = rule;
  }
});

function applyRule(trans, rule) {
  if (!trans.splits || !trans.splits.length)
    updateTransCategory(trans, rule.category_id);
}

function updateTransCategory(trans, category_id) {
  trans.splits = [];
  if (category_id)
    trans.splits.push({category_id: category_id, amount: trans.amount});

  postEntity(trans, '/transactions');
  let sel = document.querySelector(`select[data-trans-id="${trans.id}"]`);
  if (sel)
    sel.value = category_id;
}

loadData();

async function loadData() {
  let start_month = `${year_sel.value}-${month_sel.value}`;
  let end_month = getNextMonthISO(start_month);

  await loadMonth(start_month, end_month);
  report();
}

async function loadMonth(start_month, end_month) {
  // on the initial load, we also need to load the rules & categories (1st, b/c this helps w/ the others)
  let entities_to_load = [];
  if (!window.rules)
    entities_to_load.push('rules');
  if (!window.categories)
    entities_to_load.push('categories');

  // every time we switch months, we need to load/update the relevant categories/transactions
  entities_to_load = entities_to_load.concat(['category_amounts', 'transactions']);

  for (let entity of entities_to_load) {
    let url = `/${entity}`;
    if (entity == 'category_amounts' || entity == 'transactions')
      url += `/${start_month}/${end_month}`;

    let res = await fetch(url);
    let records = await res.json();

    if (entity == 'transactions') {
      for (let trans of records)
        if (rule_lookup[trans.description])
          applyRule(trans, rule_lookup[trans.description]);
    }

    // transactions are "sticky" - we keep transactions from other date-ranges in memory
    // to aid in dupe-detections & data loading from CSV files that cover multiple months
    // but when loading transactions for a particular month, we do need to *replace* existing transactions from that month
    if (entity == 'transactions' && window.transactions) {
      let trans_in_month = transactions.filter(t => t.post_date > start_month && t.post_date < end_month);
      transactions = _.difference(transactions, trans_in_month);
      window.transactions = window.transactions.concat(records);
    }
    else {
      window[entity] = records;
      
      // populate rule lookup
      if (entity == 'rules') {
        for (let rule of rules)
          rule_lookup[rule.description] = rule;
      }
    }
  }

  loaded_months.push({start_month: start_month, end_month: end_month});
}

async function postTransactions(transactions) {
  for (let trans of transactions) {
    let res = await postEntity(trans, '/transactions');
    trans.id = res.id;
  }
}

async function postEntity(obj, path) {
  let res = await fetch(path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(obj)
  });
  
  if (res.status != 200)
    throw new Error(`HTTP Error ${res.status}`);
  return await res.json();
}

// file drag hover
function FileDragHover(e) {
  e.stopPropagation();
  e.preventDefault();
  e.target.className = (e.type == "dragover" ? "hover" : "");
}

// TODO: after a drag-and-drop of file(s), I should display
// a bootstrap info alert that says "3 files dropped: filename1.csv (Apr 2016: 23 tx, May 2016: 1tx), ..."
function FileSelectHandler(e) {
  // cancel event and hover styling
  FileDragHover(e);

  // fetch FileList object
  let files = e.target.files || e.dataTransfer.files;

  // process all Files
  let num_files_imported = 0, num_files_skipped = 0;
  _.toArray(files).forEach(function(file) {
    console.log('file dropped:', file.name, file.type, file.size);
    let reader = new FileReader();
    reader.onload = async function(e) {
      let text = reader.result;
      let type = getFileType(file.name);
      if (type) {
        let new_records = loadCSV(text, type);

        // JIT pre-load from server all data from relevant month(s)
        // so we can detect & filter out dupes
        for (let record of new_records) {
          let start_month = record.post_date.slice(0, 7);
          if (!_.findWhere(loaded_months, {start_month: start_month}))
            await loadMonth(start_month, getNextMonthISO(start_month));
        }

        let dupes = window.transactions ? getDupes(new_records, transactions) : [];        
        if (dupes.length) {
          if (confirm(`${dupes.length} of the ${new_records.length} transactions in ${file.name} appear to be duplicates of existing transactions. Import remaining ${new_records.length - dupes.length} transactions?`)) {
            new_records = _.difference(new_records, dupes);
            for (let dupe of dupes)
              console.log(`Skipped duplicate: ${JSON.stringify(dupe)}`);
          }
          else {
            console.log(`User cancelled importing ${file.name} due to apparently duplicate transactions.`);
            new_records = [];
          }
        }
        
        if (window.transactions)
          window.transactions = transactions.concat(new_records);
        else
          window.transactions = new_records;
          
        console.log(`Imported ${new_records.length} transactions from ${file.name}`);

        // wait for transactions to be posted so report() has trans IDs to include in UI
        if (new_records.length) {
          await postTransactions(new_records);
          num_files_imported++;
          
          // apply categorization rules to newly-imported transactions
          // *after* they've been successfully posted to the server
          // otherwise they're posted twice simultaneously & two records are created
          for (let trans of new_records)
            if (rule_lookup[trans.description])
              applyRule(trans, rule_lookup[trans.description]);
        }
        else {
          num_files_skipped++;
        }
      }
      else {
        num_files_skipped++;
      }

      report();

      if (num_files_skipped + num_files_imported == files.length)
        alert(num_files_imported + ' CSV files imported');
    };
    reader.readAsText(file);
  })
}

function report() {
  let filter_month_iso = year_sel.value + '-' + month_sel.value;
  let next_month_iso = getNextMonthISO(filter_month_iso);

  let filtered_records = transactions.filter(function(r) {
    return r.post_date > filter_month_iso && r.post_date < next_month_iso;
  });

  filtered_records = _.sortBy(filtered_records, function(r) {
    return -Math.abs(r.amount);
  });

  let html = '<table class="table table-condensed table-striped">';
  html += '<tr><td class="amt"><b>' + Math.round(sum(filtered_records, 'amount') * 100) / 100 + '</b></td><td><b>Total</b></td><td></td><td></td></tr>';
  filtered_records.forEach(function(r) {
    let split = r.splits[0] || {};
    let cat_opts = getCategoryOptions(split.category_id);
    html += `<tr>${renderAmountCell(r.amount)}<td>${r.description}</td><td><select class="billing-cat" data-trans-id="${r.id}">${cat_opts}</select> <button class="btn btn-default btn-xs" disabled>Split</button></td><td>${r.post_date}</td></tr>`;
  });

  html += '</table>';
  report_div.innerHTML = html;
}

function getNextMonthISO(prev_month_iso) {
  let parts = prev_month_iso.split('-');
  let year_val = parts[0];
  let month_val = parts[1];
  let next_month = parseInt(month_val, 10) + 1;
  let next_month_yr = parseInt(year_val, 10);
  if (next_month == 13) {
    next_month_yr++;
    next_month = 1;
  }
  return next_month_yr + '-' + pad2(next_month);
}

function getCategoryOptions(selected_cat_id) {
  let cat_opts = categories.map(function(cat) {
    return `<option value="${cat.id}" ${selected_cat_id == cat.id ? 'selected' : ''}>${cat.name}</option>`;
  }).join('\n');
  return `<option></option>${cat_opts}<option value="_new">New Category...</option>`;
}

function renderAmountCell(amt) {
  let html = '<td class="amt';
  if (amt < 0)
    html += ' neg';
  html +='">';
  let whole_dollars = Math.floor(amt);
  html += whole_dollars + '.' + pad2(Math.round((amt - whole_dollars) * 100));
  html += '</td>';
  return html;
}

function getFileType(filename) {
  if (/Transactions( \(\d+\))?\.csv/.test(filename))
    return 'AmEx';
  else if (/\w+_9667( \(\d+\))?\.csv/.test(filename))
    return 'BofA';
  else if (/filename( \(\d+\))?\.csv/.test(filename))
    return 'WestEdge';
  else if (/filename-\d+\.csv/.test(filename))
    return 'WestEdge';
  else if (/_CURRENT_VIEW( \(\d+\))?\.CSV/.test(filename))
    return 'CitiBank';
  else if (/Since \w+ \d\d, \d\d\d\d( \(\d+\))?\.CSV/i.test(filename))
    return 'CitiBank';
  else if (/Statement closed \w+ \d\d, \d\d\d\d( \(\d+\))?\.CSV/i.test(filename))
    return 'CitiBank';
  else
    alert('Unable to parse CSV, unrecognized filename pattern: "' + filename + '"');
  return null;
}

function loadCSV(csv_str, type) {
  if (type != 'WestEdge' && type != 'AmEx' && type != 'BofA' && type != 'CitiBank')
    throw new Error('unknown type: ' + type);
  
  if (type == 'WestEdge') {
    // strip out first double line-break
    csv_str = csv_str.replace('\n', '');
  }

  let header;
  if (type == 'WestEdge' || type == 'BofA' || type == 'CitiBank')
    header = true;
  if (type == 'AmEx')
    header = ['Post Date', 'Unknown', 'Description', 'Card Name', 'Card Number', 'Unknown3', 'Unkown4', 'Amount', '2', '3', '4', '5', '6', '7', '8', '9'];

  let data = new CSV(csv_str, {header: header, cast: false}).parse();
  data.forEach(function(obj) {
    if (type == 'BofA') {
      obj.amount = obj.Amount;
      obj.post_date = obj['Posted Date'];
      obj.description = obj.Payee;
    }
    if (type == 'CitiBank') {
      obj.amount = -parseAmount(obj.Credit);
      obj.amount -= parseAmount(obj.Debit);
      obj.post_date = obj.Date;
      obj.description = obj.Description;
    }
    else {
      obj.amount = parseAmount(obj.Amount);
      obj.post_date = obj['Post Date'];
      obj.description = obj.Description;
    }

    // TODO: default categorizations
    obj.splits = [];

    // finessing of properties
    if (type == 'AmEx')
      obj.post_date = obj.post_date.split(' ')[0];
    
    obj.post_date = toISO(obj.post_date);
    
    if (type == 'AmEx')
      obj.amount = -obj.amount;
  });
  return data;
}

function getDupes(new_records, transactions) {
  return new_records.filter(function(r) {
    return _.findWhere(transactions, {
      description: r.description,
      amount: r.amount,
      post_date: r.post_date
    });
  });
}

function sum(records, property) {
  let total = 0;
  records.forEach(function(r) {
    total += r[property];
  });
  return total;
}

function toISO(dt_str) {
  let parts = dt_str.split('/');
  parts = parts.map(function(part) {
    return parseInt(part, 10);
  });
  return parts[2] + '-' + pad2(parts[0]) + '-' + pad2(parts[1]);
}

function pad2(num) {
  if (num < 10)
    return '0' + num;
  else
    return num;
}

function parseAmount(amt) {
  if (amt.trim().length == 0)
    return 0;

  let negative = false;
  if (amt[0] == '(' && amt[amt.length - 1] == ')') {
    negative = true;
    amt = amt.slice(1, -1);
  }
  
  if (amt[0] == '$')
    amt = amt.slice(1);

  // strip out any commas in the amount
  amt = amt.replace(',', '');

  amt = parseFloat(amt);
  
  if (negative)
    amt = -amt;
  return amt;
}
