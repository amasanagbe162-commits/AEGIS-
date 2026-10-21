// Safe equivalents of vulnerable/xss.js. Test data. Never run.
function render(el, comment) {
  el.textContent = comment.text;
  el.innerHTML = "<b>static markup</b>";
}
module.exports = { render };
