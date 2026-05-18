import { Link } from 'react-router-dom';
import StudioLogo from '../components/StudioLogo.jsx';

export default function NotFound() {
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center gap-4 text-ink-300 bg-ink-900">
      <StudioLogo size="md" />
      <div className="text-3xl tracking-tight text-ink-100">404</div>
      <Link to="/" className="btn-primary">Home</Link>
    </div>
  );
}
