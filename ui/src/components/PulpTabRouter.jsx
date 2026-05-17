import PulpGameTab from '../pages/PulpGameTab.jsx';
import PulpFontTab from '../pages/PulpFontTab.jsx';
import PulpTiles from '../pages/PulpTiles.jsx';
import PulpRooms from '../pages/PulpRooms.jsx';
import PulpScripts from '../pages/PulpScripts.jsx';
import PulpSounds from '../pages/PulpSounds.jsx';
import PulpPlay from '../pages/PulpPlay.jsx';
import PulpExport from '../pages/PulpExport.jsx';

// Song + sound currently share PulpSounds (it has internal SFX/Songs tabs).
// PulpEditor passes a hint via the `activeTab` prop so the page can default
// to the correct sub-tab.
function SoundOrSong({ kind }) {
  return <PulpSounds initialTab={kind === 'song' ? 'songs' : 'sfx'} />;
}

const TAB_COMPONENTS = {
  game:   () => <PulpGameTab />,
  font:   () => <PulpFontTab />,
  room:   () => <PulpRooms />,
  tile:   () => <PulpTiles />,
  song:   () => <SoundOrSong kind="song" />,
  sound:  () => <SoundOrSong kind="sound" />,
  script: () => <PulpScripts />,
  play:   () => <PulpPlay />,
  export: () => <PulpExport />
};

export default function PulpTabRouter({ activeTab }) {
  const Render = TAB_COMPONENTS[activeTab] || TAB_COMPONENTS.game;
  return <Render />;
}
