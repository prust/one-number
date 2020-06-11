var records = [];
var filedrag = document.getElementById('filedrag');
filedrag.addEventListener("dragover", FileDragHover, false);
filedrag.addEventListener("dragleave", FileDragHover, false);
filedrag.addEventListener("drop", FileSelectHandler, false);

loadData();

async function loadData() {
  let res = await fetch('/transactions');
  let new_records = await res.json();
  records = records.concat(new_records);
  report();

  res = await fetch('/splits');
  let splits = await res.json();
  return;
}

async function postTransactions(transactions) {
  for (let trans of transactions)
    await postTransaction(trans);
}

async function postTransaction(trans) {
  let res = await fetch('/transaction', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(trans)
  });
  
  if (res.status != 200)
    throw new Error(`HTTP Error ${res.status}`);
  return res;
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
        var num_dupes = checkForDupes(new_records, records);
        if (!num_dupes || confirm(num_dupes + ' of the ' + new_records.length + ' records in ' + file.name + ' are potential dupes. Continue importing this file?')) {
          records = records.concat(new_records);
          num_files_imported++;
        }
        else {
          num_files_skipped++;
        }
        postTransactions(new_records);
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

var year_sel = document.getElementById('year-sel');
var month_sel = document.getElementById('month-sel');
year_sel.addEventListener('change', report);
month_sel.addEventListener('change', report);

function report() {
  var filter_month_iso = year_sel.value + '-' + month_sel.value;
  var next_month = parseInt(month_sel.value, 10) + 1;
  var next_month_yr = parseInt(year_sel.value, 10);
  if (next_month == 13) {
    next_month_yr++;
    next_month = 1;
  }
  var next_month_iso = next_month_yr + '-' + pad2(next_month);

  var filtered_records = records.filter(function(r) {
    return r.post_date > filter_month_iso && r.post_date < next_month_iso;
  });

  filtered_records = _.sortBy(filtered_records, function(r) {
    return -Math.abs(r.amount);
  });

  var html = '<table class="table table-condensed table-striped">';
  html += '<tr><td class="amt"><b>' + Math.round(sum(filtered_records, 'amount') * 100) / 100 + '</b></td><td><b>Total</b></td><td></td></tr>';
  filtered_records.forEach(function(r) {
    html += '<tr>' + renderAmountCell(r.amount) + '<td>' + r.description + '</td><td>' + r.post_date + '</td></tr>';
  });

  html += '</table>';
  document.getElementById('report').innerHTML = html;
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

function checkForDupes(new_records, records) {
  num_dupes = 0;
  new_records.forEach(function(r) {
    if (_.findWhere(records, {description: r.description, amount: r.amount, post_date: r.post_date}))
      num_dupes++;
  });
  return num_dupes;
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
