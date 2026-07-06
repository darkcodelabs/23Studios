'use strict';
// Cleaner, calmer room art — Under-the-Tree restraint (readable, high-contrast,
// few well-chosen props, generous negative space, clear focal point, open floor).
// All via the local claude-code Aseprite pipeline. node gen_clean.js <name>
process.env.ASEPRITE_CLAUDE_TIMEOUT_MS = process.env.ASEPRITE_CLAUDE_TIMEOUT_MS || '1200000';
const fsp = require('fs/promises'); const path = require('path');
const SERVER = path.resolve(__dirname, '..', '..', '..', 'server');
const gen = require(path.join(SERVER, 'services', 'aseprite_script_gen'));
const IMAGES = path.join(__dirname, 'source', 'images'); const SRC = path.join(__dirname, 'aseprite_src');

const STYLE = [
  'HAKCD clean style (Under the Tree restraint): high-contrast 1-bit, READABLE and CALM.',
  'A clear single focal point, only a few well-chosen props, generous negative space, strong',
  'silhouettes. Dithering used sparingly for depth and mood, NEVER as busy all-over noise.',
  'Pure black & white, no gray, no anti-aliasing. Reads instantly on a 400x240 LCD.',
].join(' ');
const IMG = (n,w,h)=>'kind="image" '+(w||400)+'x'+(h||240)+': single flat image, no ExportSpriteSheet. Flatten and '+
  'sprite:saveAs(app.fs.joinPath(os.getenv("ASE_OUT_DIR"),"'+n+'.png")). Exactly '+n+'.png. Save the .aseprite too. Fill the canvas.';

const A = [
  { spec:{name:'room_bedroom',kind:'image',frameW:400,frameH:240},
    prompt:'A CLEAN isometric 1998 hacker bedroom, 3/4 top-down, CALM and readable. One clear focal point: a desk '+
      'with a CRT monitor (softly glowing screen) and a tower PC against the left wall. A few restrained props ONLY: '+
      'a bed at right, a window with blinds and moonlight, a single poster. Lots of open, empty floor in the CENTER '+
      '(x120-280, y150-220) for the walkable hero. Strong silhouettes, sparing dither for wall/floor depth, NOT busy. '+
      'Plenty of negative space. Atmospheric, quiet, late-night. '+IMG('room_bedroom') },
];
(async()=>{
  const only = process.argv[2]||'room_bedroom';
  for (const a of A){ if(a.spec.name!==only) continue;
    const t0=Date.now(); console.log('[clean] '+a.spec.name+' ...');
    const r=await gen.generateAsset({prompt:a.prompt,spec:a.spec,styleGuide:STYLE,model:'claude-code',projectId:null,maxAttempts:4});
    if(!r.ok){console.log('FAIL '+a.spec.name);process.exit(1);}
    for(const art of r.artifacts){ if(art.name.endsWith('.png')) await fsp.copyFile(art.path,path.join(IMAGES,art.name));
      else if(art.name.endsWith('.aseprite')) await fsp.copyFile(art.path,path.join(SRC,art.name)); }
    await fsp.writeFile(path.join(SRC,a.spec.name+'.lua'),r.script,'utf8');
    console.log('OK '+a.spec.name+' attempts='+r.attempts+' '+((Date.now()-t0)/1000).toFixed(0)+'s');
  }
})();
