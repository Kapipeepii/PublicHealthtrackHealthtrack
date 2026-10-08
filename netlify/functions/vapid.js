// Two jobs, both about this site's own Web Push (VAPID) key pair:
//
//   GET /.netlify/functions/vapid
//       -> { publicKey } read from the VAPID_PUBLIC_KEY env var. index.html calls this
//          when turning Push on, so the public key no longer has to be hard-coded in the
//          page (every person who deploys their own copy has their own key pair).
//          503 { error: 'not_configured' } while the env var isn't set yet.
//
//   GET /.netlify/functions/vapid?setup=1
//       -> a one-time helper page that generates a fresh key pair ON THIS SITE (no
//          third-party website involved) for the person to copy into Netlify's
//          Environment variables. It stores nothing and only works while
//          VAPID_PRIVATE_KEY is NOT set; once the key is configured the page refuses, so
//          it can never be used to read or replace a live key.
import webpush from 'web-push';

const noStore = { 'Cache-Control': 'no-store' };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...noStore }
  });
}

function page(title, bodyHtml, status = 200) {
  const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;max-width:640px;margin:0 auto;padding:20px;line-height:1.6;color:#0f172a}
  h1{font-size:1.25rem} label{display:block;font-weight:700;margin-top:18px}
  textarea{width:100%;box-sizing:border-box;font-family:ui-monospace,monospace;font-size:13px;padding:10px;border:1px solid #cbd5e1;border-radius:10px;height:92px}
  .warn{background:#fef3c7;border-radius:10px;padding:10px 14px;margin-top:18px}
  code{background:#f1f5f9;padding:1px 6px;border-radius:6px}
  button.copy{display:block;width:100%;margin-top:8px;padding:14px;font-size:16px;font-weight:700;border:0;border-radius:10px;background:#0f172a;color:#fff}
  button.copy.done{background:#15803d}
  input[type=email]{width:100%;box-sizing:border-box;font-size:16px;padding:12px;border:1px solid #cbd5e1;border-radius:10px;margin-top:6px}
</style></head><body>${bodyHtml}</body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...noStore }
  });
}

export default async (req) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const url = new URL(req.url);

  if (url.searchParams.get('setup') === '1') {
    if (process.env.VAPID_PRIVATE_KEY) {
      return page('ตั้งค่าแล้ว', `
        <h1>ตั้งค่า VAPID key เรียบร้อยแล้ว</h1>
        <p>เว็บนี้มี <code>VAPID_PRIVATE_KEY</code> ใน Netlify อยู่แล้ว หน้านี้จึงไม่สร้างคีย์ใหม่ให้ (กันคีย์ที่ใช้งานอยู่ถูกเปลี่ยนโดยไม่ตั้งใจ)</p>
        <p>ถ้าต้องการสร้างคีย์ใหม่จริงๆ ให้ลบ <code>VAPID_PRIVATE_KEY</code> ออกจาก Environment variables ก่อน แล้วเปิดหน้านี้อีกครั้ง (ต้องกด "Enable Push" ใหม่ในแอปทุกเครื่องหลังเปลี่ยนคีย์)</p>`);
    }
    const keys = webpush.generateVAPIDKeys();
    return page('สร้าง VAPID key', `
      <h1>คีย์ Push ของเว็บนี้ (สร้างใหม่ทุกครั้งที่เปิดหน้านี้)</h1>
      <p>แตะปุ่ม <b>คัดลอก</b> ใต้แต่ละช่อง แล้วสลับไปวางในหน้า Netlify → Project configuration → Environment variables ตามชื่อที่ระบุ (ทำทีละค่า ห้ามรีเฟรชหน้านี้ระหว่างทำ)</p>
      <label>1) ชื่อ: <code>VAPID_PUBLIC_KEY</code></label>
      <textarea id="k1" readonly onclick="this.select()">${keys.publicKey}</textarea>
      <button type="button" class="copy" onclick="htCopy('k1',this)">คัดลอกค่าข้อ 1</button>
      <label>2) ชื่อ: <code>VAPID_PRIVATE_KEY</code></label>
      <textarea id="k2" readonly onclick="this.select()">${keys.privateKey}</textarea>
      <button type="button" class="copy" onclick="htCopy('k2',this)">คัดลอกค่าข้อ 2</button>
      <label>3) ชื่อ: <code>VAPID_SUBJECT</code></label>
      <p style="margin:4px 0">พิมพ์อีเมลจริงของคุณ แล้วกดคัดลอก ระบบจะเติม <code>mailto:</code> ให้เอง</p>
      <input id="em" type="email" inputmode="email" autocomplete="email" placeholder="you@gmail.com">
      <button type="button" class="copy" onclick="htCopyMail(this)">คัดลอกค่าข้อ 3</button>
      <div class="warn"><b>ห้ามส่งหรือโพสต์คีย์ข้อ 2 ให้ใคร</b> และต้องใช้คีย์ข้อ 1 กับ 2 จาก "การเปิดหน้านี้ครั้งเดียวกัน" ถ้ารีเฟรชหน้า จะได้คีย์ชุดใหม่ ต้องเปลี่ยนทั้งสองค่าตาม หลังบันทึกแล้วต้องสั่ง Deploy ใหม่ 1 ครั้ง</div>
      <script>
      function htDone(btn){var t=btn.textContent;btn.textContent='คัดลอกแล้ว ✓';btn.classList.add('done');setTimeout(function(){btn.textContent=t;btn.classList.remove('done');},2000);}
      function htCopyText(text,btn,srcEl){
        function fallback(){
          try{
            var el=srcEl||document.createElement('textarea');
            if(!srcEl){el.value=text;el.style.position='fixed';el.style.opacity='0';document.body.appendChild(el);}
            el.select();el.setSelectionRange(0,99999);
            var ok=document.execCommand('copy');
            if(!srcEl)document.body.removeChild(el);
            if(ok)htDone(btn);else alert('คัดลอกอัตโนมัติไม่สำเร็จ ให้แตะค้างที่ช่องแล้วเลือก คัดลอก');
          }catch(e){alert('คัดลอกอัตโนมัติไม่สำเร็จ ให้แตะค้างที่ช่องแล้วเลือก คัดลอก');}
        }
        if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(text).then(function(){htDone(btn);},fallback);}else{fallback();}
      }
      function htCopy(id,btn){var el=document.getElementById(id);htCopyText(el.value,btn,el);}
      function htCopyMail(btn){
        var v=document.getElementById('em').value.trim();
        if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(v)){alert('กรุณาพิมพ์อีเมลให้ถูกต้องก่อน');return;}
        htCopyText('mailto:'+v,btn,null);
      }
      </script>`);
  }

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) return json({ error: 'not_configured' }, 503);
  return json({ publicKey });
};
