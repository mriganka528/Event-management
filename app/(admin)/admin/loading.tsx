import { WorkspacePageSkeleton } from "@/components/layout/loading-skeletons";

/**
 * Instant feedback for every admin route that does not declare its own loading
 * state. The shell (sidebar and notifications) stays mounted; only the content
 * area shows the skeleton while the server resolves the page.
 */
export default function AdminLoading() {
  return <WorkspacePageSkeleton />;
}
