import { useEffect, useState } from 'react';
import { sceneUrl } from '../lib/pulp_scenes.js';

// PulpRoomBackground
//
// Renders the room scene PNG absolutely positioned filling its parent at a
// configurable opacity. The grid canvas (sibling, painted ABOVE this) remains
// the click target — this element sets `pointer-events:none` so all mouse
// events pass straight through to the canvas underneath the tile grid.
//
// Props:
//   projectId   string
//   roomId      string
//   cacheBust   number|string  bump to force the <img> to re-fetch
//   opacity     number          default 0.3
//   className   string          extra classes on the wrapper
//
// If the GET /scene endpoint returns 404 (no scene yet) the image stays
// invisible so the grid is unobstructed.
export default function PulpRoomBackground({
  projectId,
  roomId,
  cacheBust,
  opacity = 0.3,
  className = ''
}) {
  const [failed, setFailed] = useState(false);

  // Reset failure flag whenever the cache key bumps so a new upload retries.
  useEffect(() => { setFailed(false); }, [cacheBust, projectId, roomId]);

  if (!projectId || !roomId) return null;

  return (
    <img
      src={sceneUrl(projectId, roomId, cacheBust)}
      alt=""
      aria-hidden="true"
      draggable={false}
      onError={() => setFailed(true)}
      onLoad={() => setFailed(false)}
      className={`absolute inset-0 w-full h-full object-cover pointer-events-none select-none ${className}`}
      style={{
        imageRendering: 'pixelated',
        opacity: failed ? 0 : opacity,
        transition: 'opacity 120ms linear'
      }}
    />
  );
}
