import { WorkbenchApp } from '../../../../../components/enterprise/workbench-app';

export default async function WorkbenchPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <WorkbenchApp slug={decodeURIComponent(slug)}/>;
}
