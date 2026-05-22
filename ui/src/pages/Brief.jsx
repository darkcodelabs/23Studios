// Brief — Phase 4.5 Part 0 sidebar entry (renamed from "Concepts").
//
// Thin re-export wrapper around ConceptPicker. Lives as its own file so the
// router can address /projects/:id/author/brief without leaking the legacy
// "concepts" naming into the route table. When the brief surface diverges
// from the concept picker, replace the re-export with a real component.

import ConceptPicker from './ConceptPicker.jsx';

export default function Brief() {
  return <ConceptPicker />;
}
