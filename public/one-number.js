var filedrag = document.getElementById('filedrag');
filedrag.addEventListener("dragover", FileDragHover, false);
filedrag.addEventListener("dragleave", FileDragHover, false);
filedrag.addEventListener("drop", FileSelectHandler, false);

var year_sel = document.getElementById('year-sel');
var month_sel = document.getElementById('month-sel');
year_sel.value = new Date().getFullYear();
month_sel.value = pad2(new Date().getMonth() + 1);
year_sel.addEventListener('change', loadData);
month_sel.addEventListener('change', loadData);

var report_div = document.getElementById('report');
report_div.addEventListener('change', async function(evt) {
  var el = evt.target;
  if (el.tagName == 'SELECT') {
    if (el.value == '_new') {
      let new_cat_name = prompt('New Category Name:');
      if (new_cat_name) {
        let new_cat = await postEntity({name: new_cat_name}, '/categories');
        categories.push(new_cat);
        
        // update the options on all SELECTs on the page, while retaining their value
        for (let sel of document.querySelectorAll('SELECT')) {
          let val = sel.value;
          sel.innerHTML = getCategoryOptions();
          if (val)
            sel.value = val;
        }
        
        el.value = new_cat.id;
      }
      else {
        el.value = '';
      }
    }

    // update transaction in the DB
    let trans_id = parseInt(el.getAttribute('data-trans-id'));
    let trans = _.findWhere(transactions, {id: trans_id});

    trans.splits = [];
    let category_id = el.value ? parseInt(el.value) : null;
    if (category_id)
      trans.splits.push({category_id: category_id, amount: trans.amount});

    postEntity(trans, '/transactions');
  }
});

loadData();

async function loadData() {
  let start_month = `${year_sel.value}-${month_sel.value}`;
  let end_month = getNextMonthISO(year_sel.value, month_sel.value);

  // every time we switch months, we need to load/update the relevant categories/transactions
  let entities_to_load = ['category_amounts', 'transactions'];

  // on the initial load, we also need to load the rules & categories
  if (!window.rules)
    entities_to_load.push('rules');
  if (!window.categories)
    entities_to_load.push('categories');

  for (let entity of entities_to_load) {
    let url = `/${entity}`;
    if (entity == 'category_amounts' || entity == 'transactions')
      url += `/${start_month}/${end_month}`;

    let res = await fetch(url);
    let records = await res.json();

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
    }
  }

  report();
}

async function postTransactions(transactions) {
  for (let trans of transactions)
    await postEntity(trans, '/transactions');
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
  var files = e.target.files || e.dataTransfer.files;

  // process all Files
  var num_files_imported = 0, num_files_skipped = 0;
  _.toArray(files).forEach(function(file) {
    console.log('file dropped:', file.name, file.type, file.size);
    var reader = new FileReader();
    reader.onload = function(e) {
      var text = reader.result;
      var type = getFileType(file.name);
      if (type) {
        var new_records = loadCSV(text, type);

        var dupes = window.transactions ? getDupes(new_records, transactions) : [];        
        if (dupes.length) {
          if (confirm(`${dupes.length} of the ${new_records.length} transactions in ${file.name} appear to be duplicates of existing transactions. Import remaining ${new_records.length - dupes.length} transactions?`)) {
            new_records = _.without(new_records, dupes);
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
        if (new_records.length) {
          postTransactions(new_records);
          num_files_imported++;
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
  var filter_month_iso = year_sel.value + '-' + month_sel.value;
  var next_month_iso = getNextMonthISO(year_sel.value, month_sel.value);

  var filtered_records = transactions.filter(function(r) {
    return r.post_date > filter_month_iso && r.post_date < next_month_iso;
  });

  filtered_records = _.sortBy(filtered_records, function(r) {
    return -Math.abs(r.amount);
  });

  var html = '<table class="table table-condensed table-striped">';
  html += '<tr><td class="amt"><b>' + Math.round(sum(filtered_records, 'amount') * 100) / 100 + '</b></td><td><b>Total</b></td><td></td><td></td></tr>';
  filtered_records.forEach(function(r) {
    let split = r.splits[0] || {};
    let cat_opts = getCategoryOptions(split.category_id);
    html += `<tr>${renderAmountCell(r.amount)}<td>${r.description}</td><td><select data-trans-id="${r.id}">${cat_opts}</select> <button class="btn btn-default btn-xs" disabled>Split</button></td><td>${r.post_date}</td></tr>`;
  });

  html += '</table>';
  report_div.innerHTML = html;
}

function getNextMonthISO(year_val, month_val) {
  var next_month = parseInt(month_val, 10) + 1;
  var next_month_yr = parseInt(year_val, 10);
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
  var html = '<td class="amt';
  if (amt < 0)
    html += ' neg';
  html +='">';
  var whole_dollars = Math.floor(amt);
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

  var header;
  if (type == 'WestEdge' || type == 'BofA' || type == 'CitiBank')
    header = true;
  if (type == 'AmEx')
    header = ['Post Date', 'Unknown', 'Description', 'Card Name', 'Card Number', 'Unknown3', 'Unkown4', 'Amount', '2', '3', '4', '5', '6', '7', '8', '9'];

  var data = new CSV(csv_str, {header: header, cast: false}).parse();
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
  var total = 0;
  records.forEach(function(r) {
    total += r[property];
  });
  return total;
}

function toISO(dt_str) {
  var parts = dt_str.split('/');
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

  var negative = false;
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
