export function cleanAIOutput(text: string): string {
  let s = text;

  // Remove think/thought tags (DeepSeek, Qwen, etc.)
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, "");
  s = s.replace(/<thought>[\s\S]*?<\/thought>/gi, "");

  // Remove special tokens
  s = s.replace(/<\|im_start\|>/g, "");
  s = s.replace(/<\|im_end\|>/g, "");
  s = s.replace(/<\|assistant\|>/g, "");
  s = s.replace(/<\|user\|>/g, "");
  s = s.replace(/<\|system\|>/g, "");

  // Remove Chinese think markers
  s = s.replace(/思考[\s\S]*?(?:\n|$)/g, "");

  // Collapse multiple newlines
  s = s.replace(/\n{3,}/g, "\n\n");

  // Remove leading/trailing whitespace per line
  s = s.split("\n").map(l => l.trim()).join("\n");

  // Protect markdown links: the paren strip below would otherwise delete
  // every link destination (e.g. Florence signup links).
  const mdLinks: string[] = [];
  s = s.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, label, url) => {
    mdLinks.push(`[${label}](${url})`);
    return `__MDLINK${mdLinks.length - 1}__`;
  });

  // Strip parenthesized content (citations, references)
  s = s.replace(/\([^)]*\)/g, "");

  // Restore protected markdown links
  s = s.replace(/__MDLINK(\d+)__/g, (_m, i) => mdLinks[Number(i)]);

  // Strip whole lines wrapped in markdown italic/bold (roleplay narration)
  s = s.replace(/^\s*\*{1,2}[^*].*\*{1,2}\s*$/gm, "");
  s = s.replace(/^\s*\*{1,2}\s*$/gm, "");

  // Collapse blank lines left by removals
  s = s.replace(/\n{3,}/g, "\n\n");

  return s.trim();
}
