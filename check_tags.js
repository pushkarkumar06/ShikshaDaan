// usage: node check_tags.js path/to/App.vue
import fs from 'fs';
const path = process.argv[2];
if (!path) { console.error('Usage: node check_tags.js path/to/App.vue'); process.exit(1); }
const content = fs.readFileSync(path, 'utf8');

// very small parser: checks opening/closing for common container tags
const tagsToCheck = ['div','section','template','header','footer','main','article','aside','nav'];
const openStack = [];
const re = /<\/?([a-zA-Z0-9\-:]+)(\s[^>]*)?>/g;
let m;
let lineOffsets = content.split('\n').map((l,i)=>({l,i}));
function lineOfIndex(idx) {
  const lines = content.slice(0, idx).split('\n');
  return lines.length;
}
while ((m = re.exec(content))) {
  const full = m[0];
  const tag = m[1];
  const isClose = full.startsWith('</');
  const idx = m.index;
  if (!tagsToCheck.includes(tag)) continue;
  if (!isClose) { openStack.push({tag, idx, line: lineOfIndex(idx)}); }
  else {
    // try match last open of same tag
    if (openStack.length === 0) {
      console.error(`Unmatched closing </${tag}> at approx line ${lineOfIndex(idx)}`);
    } else {
      let last = openStack[openStack.length-1];
      if (last.tag === tag) {
        openStack.pop();
      } else {
        // find matching open
        let foundIdx = -1;
        for (let i=openStack.length-1;i>=0;i--) if (openStack[i].tag===tag) { foundIdx=i; break; }
        if (foundIdx === -1) {
          console.error(`Unmatched closing </${tag}> at approx line ${lineOfIndex(idx)}`);
        } else {
          console.error(`Tag mismatch: found closing </${tag}> at line ${lineOfIndex(idx)} but last open is <${last.tag}> at line ${last.line}`);
        }
      }
    }
  }
}
if (openStack.length) {
  console.error('Unclosed opening tags remaining:');
  openStack.forEach(o=> console.error(`  <${o.tag}> opened at approx line ${o.line}`));
  process.exit(2);
}
console.log('Tag balance check: OK');
