// Safe equivalents of vulnerable/xss.js. Test data. Never run.
function render(el, comment) {
  el.textContent = comment.text;
  el.innerHTML = "<b>static markup</b>";
  el.insertAdjacentText("beforeend", comment.text);
  el.insertAdjacentHTML("beforeend", "<hr>");
}
module.exports = { render };
