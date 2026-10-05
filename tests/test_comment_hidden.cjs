const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "dtf.user.js"),
  "utf8",
);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dtf-hidden-comments-"));
const html = path.join(dir, "games", "999-hidden.html");
fs.mkdirSync(path.dirname(html));
const detail = (id, date, text, user, media = []) => ({
  status: "ok",
  data: { id: String(id), post_id: "999", data: { date, text, user, media } },
});
const users = {
  10: { id: 10, name: "Parent", avatar: "parent-avatar" },
  20: { id: 20, name: "First hidden", avatar: "first-avatar" },
  21: { id: 21, name: "Second hidden", avatar: "second-avatar" },
  30: { id: 30, name: "Excluded hidden", avatar: "excluded-avatar" },
  40: { id: 40, name: "Restored author", avatar: "restored-avatar" },
};
const details = {
  10: detail(10, 10, "parent text", users[10]),
  20: detail(20, 20, "first text", users[20], [
    { type: "image", data: { uuid: "image-id", width: 320, height: 200 } },
  ]),
  21: detail(21, 30, "second text", users[21], [
    {
      type: "movie",
      data: { uuid: "video-id", width: 320, height: 200, has_audio: true },
    },
  ]),
  30: detail(30, 15, "should be filtered", users[30]),
  40: detail(40, 40, "restored removed text", users[40], [
    {
      type: "image",
      data: {
        uuid: "restored-video",
        width: 960,
        height: 720,
        isVideo: true,
        has_audio: true,
      },
    },
  ]),
};
const fixture = `<!doctype html><meta charset="utf-8"><body>
<div class="comments-header"><div class="dropdown"></div></div>
<div class="comment comment--root comment--hidden" data-id="40"><div class="comment__content"><div class="comment__avatar"><div class="comment__avatar--icon"></div></div><div class="comment-hidden"><div class="comment-hidden__text">Комментарий удалён модератором</div></div></div></div>
<script>
const values = new Map(Object.entries({showHiddenComments:true,showCommentEdits:false,showRemovedComments:true,hideCommentMedia:false,showNoCommentIcon:false,enableCommentQuote:false}));
window.GM_getValue=(key,fallback)=>values.has(key)?values.get(key):fallback;
window.GM_setValue=(key,value)=>values.set(key,value);
window.GM_addValueChangeListener=()=>1; window.GM_removeValueChangeListener=()=>{};
window.GM_registerMenuCommand=()=>{}; window.unsafeWindow=window;
window.fetch=async url=>new Response(JSON.stringify({result:{items:[
  {id:10,replyTo:0,isRemoved:false},
  {id:20,replyTo:0,isRemoved:true},
  {id:21,replyTo:10,isRemoved:true},
  {id:30,replyTo:0,isRemoved:true},
  {id:31,replyTo:30,isRemoved:false}
]}}),{headers:{'Content-Type':'application/json'}});
window.GM_xmlhttpRequest=({url,onload})=>{
  const id=Number(url.match(/\\/(\\d+)(?:\\/ids)?$/)?.[1]);
  const result=url.endsWith('/ids')?{status:'ok',data:[20,21,30,31]}:${JSON.stringify(details)}[id]||{status:'error'};
  setTimeout(()=>onload({responseText:JSON.stringify(result)}),0);
};
</script><script>${source}</script><script>
(async()=>{
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  for(let i=0;i<80&&!document.querySelector('.dtf-vm-hidden-comments');i++)await delay(50);
  const button=document.querySelector('.dtf-vm-hidden-comments');
  if(!button||button.title!=='Скрытые комментарии (2)'){document.body.dataset.result='FAIL: hidden count/button';return}
  button.click();
  const rows=[...document.querySelectorAll('.dtf-vm-comment-row')];
  if(rows.length!==2||rows.some(row=>row.textContent.includes('Excluded hidden'))){document.body.dataset.result='FAIL: descendant filtering';return}
  if(!rows[0].textContent.includes('First hidden')||!rows[1].textContent.includes('Second hidden')){document.body.dataset.result='FAIL: date ordering';return}
  if(rows[1].querySelectorAll('.dtf-vm-comment-author').length!==2||!rows[1].textContent.includes('→')){document.body.dataset.result='FAIL: reply-to author';return}
  if(document.querySelectorAll('.dtf-vm-comment-date').length!==2||document.querySelectorAll('.dtf-vm-comment-media img').length!==1||document.querySelectorAll('.dtf-vm-comment-media video').length!==1||[...document.querySelectorAll('.dtf-vm-comment-media')].some(media=>media.style.maxWidth!=='320px')){document.body.dataset.result='FAIL: dates, media, or sizing';return}
  for(let i=0;i<80&&!document.querySelector('.comment[data-id="40"] .comment-text');i++)await delay(50);
  const restored=document.querySelector('.comment[data-id="40"]');
  if(restored?.querySelector('.comment-hidden__text')||restored?.querySelector('.comment-text')?.textContent!=='restored removed text'||restored?.querySelector('.author__name')?.textContent!=='Restored author'||restored?.querySelector('time')?.textContent!=='01.01.1970'||restored?.querySelector('.comment-media video')?.src!=='https://leonardo.osnova.io/restored-video/-/format/mp4/#t=0.1'||restored?.querySelector('.comment__content')?.style.borderRight!=='3px solid red'){document.body.dataset.result='FAIL: removed comment restore';return}
  document.body.dataset.result='PASS';
})().catch(error=>document.body.dataset.result='FAIL: '+error.message);
</script></body>`;
fs.writeFileSync(html, fixture);
try {
  const result = spawnSync(
    "/usr/bin/chromium",
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--user-data-dir=${path.join(dir, "profile")}`,
      "--dump-dom",
      "--virtual-time-budget=6000",
      `file://${html}`,
    ],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  const status = result.stdout.match(/data-result="([^"]+)"/);
  assert.equal(status?.[1], "PASS", status?.[1] || result.stderr);
  console.log("OK: hidden comment order, author/reply links, dates, and media");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
