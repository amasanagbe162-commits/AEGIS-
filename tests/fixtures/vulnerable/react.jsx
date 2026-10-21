// DELIBERATELY VULNERABLE. Test data for scanner rules. Never run.
export function Comment({ html }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
