// DELIBERATELY VULNERABLE. Test data for scanner rules. Never run.
function render(el, comment) {
  el.innerHTML = comment.text;
  document.write(comment.text);
  el.insertAdjacentHTML("beforeend", comment.text);
}
module.exports = { render };
