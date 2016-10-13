
/*

	Tests pieces of code in JS

*/

var expression = new RegExp("(^(http|https)://www.)(\\w+).(\\w+$)");

console.log(expression);

console.log(expression.test("http://ww.a.n"));

console.log(expression.test("htp://www.an"));

console.log(expression.test("htp://www.a.n"));

