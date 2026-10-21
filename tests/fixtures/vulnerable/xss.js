// DELIBERATELY VULNERABLE. Test data for scanner rules. Never run.
function render(el, comment) {
  el.innerHTML = comment.text;
  document.write(comment.text);
}
module.exports = { render };
