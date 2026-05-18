import PulpGameTab from '../pages/PulpGameTab.jsx';
import PulpFontTab from '../pages/PulpFontTab.jsx';
import PulpTiles from '../pages/PulpTiles.jsx';
import PulpRooms from '../pages/PulpRooms.jsx';
import PulpScripts from '../pages/PulpScripts.jsx';
import PulpSounds from '../pages/PulpSounds.jsx';
import PulpPlay from '../pages/PulpPlay.jsx';
import PulpExport from '../pages/PulpExport.jsx';
import PulpWorkflow from '../pages/PulpWorkflow.jsx';
import PulpPreview from '../pages/PulpPreview.jsx';

// Song + sound currently share PulpSounds (it has internal SFX/Songs tabs).
// PulpEditor passes a hint via the `activeTab` prop so the page can default
// to the correct sub-tab.
function SoundOrSong({ kind }) {
  return <PulpSounds initialTab={kind === 'song' ? 'songs' : 'sfx'} />;
}

const TAB_COMPONENTS = {
  workflow: (props) => <PulpWorkflow onJumpTab={props.onJumpTab} />,
  preview: (props) => <PulpPreview onJumpTab={props.onJumpTab} />,
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

export default function PulpTabRouter({ activeTab, onJumpTab }) {
  const Render = TAB_COMPONENTS[activeTab] || TAB_COMPONENTS.workflow;
  return <Render onJumpTab={onJumpTab} />;
}
