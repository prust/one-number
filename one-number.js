var fs = require('fs');

var _ = require('underscore');
var CSV = require('comma-separated-values');

var records = loadCSV('-filename.csv', 'WestEdge');
records = records.concat(loadCSV('AX-8/1-8/7Transactions.csv', 'AmEx'));
records = records.concat(loadCSV('AX-8/8-8/23Transactions (1).csv', 'AmEx'));
records = records.concat(loadCSV('currentTransaction_9667.csv', 'BofA'));
records = records.concat(loadCSV('July2015_9667.csv', 'BofA'));

records = records.filter(function(r) {
  return r['Post Date'] > '2015-08';
});

records = _.sortBy(records, 'Amount');

records.forEach(function(r) {
  console.log(r.Amount, r.Description, r['Post Date']);
});

console.log('Sum: ' + Math.round(sum(records, 'Amount') * 100) / 100);

function loadCSV(filename, type) {
	if (type != 'WestEdge' && type != 'AmEx' && type != 'BofA')
		throw new Error('unknown type: ' + type);

	var csv_str = fs.readFileSync("C:\\Users\\prust\\Downloads\\" + filename, {encoding:'utf8'});
	
	if (type == 'WestEdge') {
		// strip out first double line-break
		csv_str = csv_str.replace('\n\n', '');
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

	  //console.log(obj.Amount, obj.Description, obj['Post Date']);
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

// var csv_str = fs.readFileSync("C:\\Users\\prust\\Downloads\\Transactions.csv", {encoding:'utf8'});
// var data = new CSV(csv_str, {header: ['Post Date', 'Unknown', 'Description', 'Card Name', 'Card Number', 'Unknown3', 'Unkown4', 'Amount', '2', '3', '4', '5', '6', '7', '8', '9']}).parse();
// data.forEach(function(obj) {
//   obj['Post Date'] = toISO(obj['Post Date'].split(' ')[0]);
//   obj.Amount = -parseAmount(obj.Amount);
//   console.log(obj.Amount, obj.Description, obj['Post Date']);
// });

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