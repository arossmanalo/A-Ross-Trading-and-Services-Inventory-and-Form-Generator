/**
 * The on-screen preview of a document that is sent together with a linked one
 * (a CSR followed by its Billing Statement, or the reverse) shows every page
 * of the PDF in the same order. Each document keeps its own page styles, so
 * each one goes in its own frame; frames resize to their content.
 */
export function combinePreviewPages(pages: readonly string[]): string {
  if (pages.length === 1) return pages[0];
  const frames = pages
    .map((html) => `<iframe scrolling="no" srcdoc="${escapeAttribute(html)}"></iframe>`)
    .join('<div class="page-gap"></div>');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
html,body{margin:0;padding:0;background:#fff}iframe{display:block;width:100%;height:600px;border:0}.page-gap{height:14px;background:#d1d5db}
</style></head><body>${frames}<script>
(function(){
  function fit(frame){try{var doc=frame.contentDocument;if(doc&&doc.documentElement){frame.style.height=Math.max(doc.documentElement.scrollHeight,doc.body?doc.body.scrollHeight:0)+'px';}}catch(e){}}
  var frames=document.getElementsByTagName('iframe');
  for(var i=0;i<frames.length;i++){(function(frame){frame.addEventListener('load',function(){fit(frame);setTimeout(function(){fit(frame);},150);});})(frames[i]);}
})();
</script></body></html>`;
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}
