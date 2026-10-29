/**
 * Renders chart markup produced by /client/charts.js. Those builders escape every piece of
 * text they interpolate, so the markup is trusted (same code the vanilla app uses).
 */
export function Svg({ markup, className }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: markup }} />;
}
