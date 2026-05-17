import PulpGameTab from '../pages/PulpGameTab.jsx';
import PulpFontTab from '../pages/PulpFontTab.jsx';
import PulpTiles from '../pages/PulpTiles.jsx';
import PulpRooms from '../pages/PulpRooms.jsx';
import PulpScripts from '../pages/PulpScripts.jsx';
import PulpSounds from '../pages/PulpSounds.jsx';

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
  script: () => <PulpScripts />
};

export default function PulpTabRouter({ activeTab }) {
  const Render = TAB_COMPONENTS[activeTab] || TAB_COMPONENTS.game;
  return <Render />;
}
