'use strict';
process.env.ASEPRITE_CLAUDE_TIMEOUT_MS = process.env.ASEPRITE_CLAUDE_TIMEOUT_MS || '1200000';
const fsp=require('fs/promises'),path=require('path');
const SERVER=path.resolve(__dirname,'..','..','..','server');
const gen=require(path.join(SERVER,'services','aseprite_script_gen'));
const IMAGES=path.join(__dirname,'source','images'),SRC=path.join(__dirname,'aseprite_src');
const STYLE=[
 'HAKCD clean style: like a MARIO 64 level rendered in 1-bit (NOT a recreation, just that clean',
 'chunky dimensional feel). Bold simple geometry with FLAT clean black/white fills and only LIGHT,',
 'SPARING dither for a touch of depth on a few surfaces — NOT heavy dithering, NOT busy noise.',
 'Playful, readable, lots of clean negative space and solid shapes. Strong silhouettes. Pure 1-bit,',
 'no gray, no anti-aliasing. Reads instantly on a 400x240 LCD.',
].join(' ');
const IMG=(n)=>'kind="image" 400x240: single flat image, no ExportSpriteSheet. Flatten and '+
 'sprite:saveAs(app.fs.joinPath(os.getenv("ASE_OUT_DIR"),"'+n+'.png")). Exactly '+n+'.png. Save .aseprite too. Fill canvas.';
const A=[
 { spec:{name:'room_lab',kind:'image',frameW:400,frameH:240},
   prompt:'A CLEAN, CHUNKY Mario-64-style EMPTY room interior, 1-bit, 3/4 isometric. Two simple back walls meeting '+
     'at a corner, a clean tiled floor drawn with bold geometry and only LIGHT sparing dither for subtle depth. A '+
     'big OPEN center and mid-floor (kept clear for a walking character and gameplay objects drawn later). A window '+
     'with moonlight on the back wall, a couple of small non-interactive props hugging the far edges only (a plant, '+
     'a crate). Flat clean fills, generous negative space, playful and dimensional, high contrast. Do NOT fill it '+
     'with detail or heavy dither. '+IMG('room_lab') },
];
(async()=>{const only=process.argv[2]||'room_lab';
 for(const a of A){if(a.spec.name!==only)continue;const t0=Date.now();console.log('[lab] '+a.spec.name+' ...');
  const r=await gen.generateAsset({prompt:a.prompt,spec:a.spec,styleGuide:STYLE,model:'claude-code',projectId:null,maxAttempts:4});
  if(!r.ok){console.log('FAIL '+a.spec.name);process.exit(1);}
  for(const art of r.artifacts){if(art.name.endsWith('.png'))await fsp.copyFile(art.path,path.join(IMAGES,art.name));
   else if(art.name.endsWith('.aseprite'))await fsp.copyFile(art.path,path.join(SRC,art.name));}
  await fsp.writeFile(path.join(SRC,a.spec.name+'.lua'),r.script,'utf8');
  console.log('OK '+a.spec.name+' attempts='+r.attempts+' '+((Date.now()-t0)/1000).toFixed(0)+'s');}
})();
