'use strict';
// Combat assets for the isometric twin-stick shooter (Spooky-Squad-like), all
// via the local claude-code Aseprite pipeline. node gen_combat.js <name>
process.env.ASEPRITE_CLAUDE_TIMEOUT_MS = process.env.ASEPRITE_CLAUDE_TIMEOUT_MS || '1200000';
const fsp = require('fs/promises'); const path = require('path');
const SERVER = path.resolve(__dirname, '..', '..', '..', 'server');
const gen = require(path.join(SERVER, 'services', 'aseprite_script_gen'));
const IMAGES = path.join(__dirname, 'source', 'images'); const SRC = path.join(__dirname, 'aseprite_src');

const STYLE = [
  'HAKCD action style: clean, high-contrast 1-bit for a fast isometric twin-stick shooter',
  '(like Spooky Squad). Bold readable silhouettes that pop against a dark arena, sparing dither',
  'for volume/glow (never busy noise), strong outlines. Pure black & white, no gray, no',
  'anti-aliasing. Must read instantly in motion on a 400x240 LCD.',
].join(' ');
const IMG = (n,w,h)=>'kind="image" '+(w||400)+'x'+(h||240)+': single flat image, no ExportSpriteSheet. Flatten and '+
  'sprite:saveAs(app.fs.joinPath(os.getenv("ASE_OUT_DIR"),"'+n+'.png")). Exactly '+n+'.png. Save .aseprite too. Fill canvas.';

const A = [
  { spec:{name:'enemy_ice',kind:'imagetable',frameW:32,frameH:32,frames:4},
    prompt:'An isometric enemy sprite sheet "ICE" (intrusion countermeasure / security daemon): a floating angular '+
      'glitchy geometric wraith with a single glowing diamond core-eye, jagged crystalline edges, a wispy dithered '+
      'tail. Menacing but clean, bold black silhouette with a bright core. 4-frame hover+pulse loop: it bobs and the '+
      'core flares, edges flicker. Reads sharp at 32x32. Export exactly enemy_ice-table-32-32.png.' },

  { spec:{name:'enemy_worm',kind:'imagetable',frameW:32,frameH:32,frames:4},
    prompt:'An isometric enemy sprite sheet "WORM" (a fast self-replicating attack program): a segmented serpentine '+
      'data-worm made of stacked bright blocks with a blunt head and a single scanning eye, trailing dither static. '+
      '4-frame slither/undulate loop. Bold silhouette, clean. Reads at 32x32. Export exactly enemy_worm-table-32-32.png.' },

  { spec:{name:'arena_sector',kind:'image',frameW:400,frameH:240},
    prompt:'A CLEAN isometric arena floor: "a network sector inside the wire". A dark tiled grid receding in iso '+
      'perspective with faint dithered circuit traces along the tile seams and a subtle vignette. A few angular data '+
      'pillars / node blocks around the EDGES only. The whole CENTER is open, dark and uncluttered for fast combat. '+
      'High contrast, minimal, atmospheric cyberspace. '+IMG('arena_sector') },

  { spec:{name:'pickup_chip',kind:'imagetable',frameW:16,frameH:16,frames:4},
    prompt:'A floating power-up pickup: a bright microchip/upgrade token with a pulsing dither glow, 4-frame '+
      'spin+pulse loop. Bold 2px outline, reads at 16x16. Export exactly pickup_chip-table-16-16.png.' },
];
(async()=>{
  const only = process.argv[2];
  for (const a of A){ if(only && a.spec.name!==only) continue;
    const t0=Date.now(); console.log('[combat] '+a.spec.name+' ...');
    const r=await gen.generateAsset({prompt:a.prompt,spec:a.spec,styleGuide:STYLE,model:'claude-code',projectId:null,maxAttempts:4});
    if(!r.ok){console.log('FAIL '+a.spec.name);process.exitCode=1;continue;}
    for(const art of r.artifacts){ if(art.name.endsWith('.png')) await fsp.copyFile(art.path,path.join(IMAGES,art.name));
      else if(art.name.endsWith('.aseprite')) await fsp.copyFile(art.path,path.join(SRC,art.name)); }
    await fsp.writeFile(path.join(SRC,a.spec.name+'.lua'),r.script,'utf8');
    console.log('OK '+a.spec.name+' attempts='+r.attempts+' '+((Date.now()-t0)/1000).toFixed(0)+'s');
  }
})();
