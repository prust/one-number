var records = [];
var filedrag = document.getElementById('filedrag');
filedrag.addEventListener("dragover", FileDragHover, false);
filedrag.addEventListener("dragleave", FileDragHover, false);
filedrag.addEventListener("drop", FileSelectHandler, false);

// file drag hover
function FileDragHover(e) {
  e.stopPropagation();
  e.preventDefault();
  e.target.className = (e.type == "dragover" ? "hover" : "");
}

function FileSelectHandler(e) {
  // cancel event and hover styling
  FileDragHover(e);

  // fetch FileList object
  var files = e.target.files || e.dataTransfer.files;

  // process all Files
  _.toArray(files).forEach(function(file) {
    console.log('file dropped:', file.name, file.type, file.size);
    var reader = new FileReader();
    reader.onload = function(e) {
      var text = reader.result;
      var type = getFileType(file.name);
      records = records.concat(loadCSV(text, type)); // 'Transactions.csv'
      report();
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
    return r['Post Date'] > filter_month_iso && r['Post Date'] < next_month_iso;
  });

  filtered_records = _.sortBy(filtered_records, function(r) {
    return -Math.abs(r.Amount);
  });

  var html = '<table class="table table-condensed table-striped">';
  html += '<tr><td class="amt"><b>' + Math.round(sum(filtered_records, 'Amount') * 100) / 100 + '</b></td><td><b>Total</b></td><td></td></tr>';
  filtered_records.forEach(function(r) {
    html += '<tr>' + renderAmountCell(r.Amount) + '<td>' + r.Description + '</td><td>' + r['Post Date'] + '</td></tr>';
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
  else if (/\w+_9667.csv/.test(filename))
    return 'BofA';
  else if (/-filename.csv/.test(filename))
    return 'WestEdge';
  else
    alert('Unable to parse CSV, unrecognized filename pattern: "' + filename + '"');
}

function loadCSV(csv_str, type) {
  if (type != 'WestEdge' && type != 'AmEx' && type != 'BofA')
    throw new Error('unknown type: ' + type);
  
  if (type == 'WestEdge') {
    // strip out first double line-break
    csv_str = csv_str.replace('\n', '');
  }

  var header;
  if (type == 'WestEdge' || type == 'BofA')
    header = true;
  if (type == 'AmEx')
    header = ['Post Date', 'Unknown', 'Description', 'Card Name', 'Card Number', 'Unknown3', 'Unkown4', 'Amount', '2', '3', '4', '5', '6', '7', '8', '9'];

  var data = new CSV(csv_str, {header: header}).parse();
  data.forEach(function(obj) {
    if (type == 'BofA') {
      obj['Post Date'] = obj['Posted Date'];
      obj.Description = obj.Payee;
    }
    if (type == 'AmEx')
      obj['Post Date'] = obj['Post Date'].split(' ')[0];
    obj['Post Date'] = toISO(obj['Post Date']);
    obj.Amount = parseAmount(obj.Amount);
    if (type == 'AmEx')
      obj.Amount = -obj.Amount;
  });
  return data;
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
  var negative = false;
  if (amt[0] == '(' && amt[amt.length - 1] == ')') {
    negative = true;
    amt = amt.slice(1, -1);
  }
  
  if (amt[0] == '$')
    amt = amt.slice(1);
  
  amt = parseFloat(amt);
  
  if (negative)
    amt = -amt;
  return amt;
}
