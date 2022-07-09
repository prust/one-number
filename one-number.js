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
var week_sel = document.getElementById('week-sel');
year_sel.addEventListener('change', report);
month_sel.addEventListener('change', report);
week_sel.addEventListener('change', report);

function report() {
  let week = week_sel.value ? parseInt(week_sel.value) : null;
  let month = parseInt(month_sel.value);
  let year = parseInt(year_sel.value);

  let start = new Date(year, month, 1); // start out at the first day of the month
  let end;

  if (week) { // filter by week
    start.setDate(start.getDate() + (week-1)*7); // bump date forward based on week # (week 1, week 2, etc)
    start.setDate(start.getDate() - start.getDay()); // bump back the first day of that wk (Sunday)
    end = new Date(start);
    end.setDate(start.getDate() + 6); // +6 gets to the Saturday at the end of the same week
  }
  else { // filter by month
    end = new Date(year, month + 1, 0); // month+1 = next month, 0-day is last day of prev month
  }

  var filtered_records = records.filter(function(r) {
    return r['Post Date'] >= dateToISO(start) && r['Post Date'] <= dateToISO(end);
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

function dateToISO(dt) {
  return `${dt.getFullYear()}-${pad2(dt.getMonth()+1)}-${pad2(dt.getDate())}`;
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
  else if (/filename( \(\d+\))?\.csv/.test(filename)) // windows/chrome? duplicate file suffix (1), (2), (3)
    return 'WestEdge';
  else if (/filename-\d?\.csv/.test(filename)) // macos/safari? duplicate file suffix -1, -2, -3
    return 'WestEdge';
  else if (filename == 'Year to date.CSV')
    return 'CitiBank';
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
      obj['Post Date'] = obj['Posted Date'];
      obj.Description = obj.Payee;
    }
    if (type == 'CitiBank') {
      obj.Amount = -parseAmount(obj.Credit);
      obj.Amount -= parseAmount(obj.Debit);
      obj['Post Date'] = obj.Date;
    }
    else {
      obj.Amount = parseAmount(obj.Amount);
    }

    if (type == 'AmEx')
      obj['Post Date'] = obj['Post Date'].split(' ')[0];
    obj['Post Date'] = stringToISO(obj['Post Date']);
    
    if (type == 'AmEx')
      obj.Amount = -obj.Amount;
  });
  return data;
}

function checkForDupes(new_records, records) {
  num_dupes = 0;
  new_records.forEach(function(r) {
    if (_.findWhere(records, {Description: r.Description, Amount: r.Amount, 'Post Date': r['Post Date']}))
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

function stringToISO(dt_str) {
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
