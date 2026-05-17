import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center gap-3 text-ink-300">
      <div className="text-3xl font-mono">404</div>
      <Link to="/" className="btn-primary">Home</Link>
    </div>
  );
}
