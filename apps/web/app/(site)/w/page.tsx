import { redirect } from 'next/navigation';
import { siteEnterprise } from '../../../lib/site-entry';

export const dynamic = 'force-dynamic';

/** Workbench front door without an enterprise in the URL: the configured enterprise's workbench, else guidance. */
export default function WorkbenchDoor() {
  const enterprise = siteEnterprise();
  if (enterprise) redirect(`/w/${enterprise}`);
  return <main className="site site--note"><section className="site__body">
    <header className="site__brand"><span className="site__mark">Hestia</span><span>企业工作台</span></header>
    <h1 className="site__title site__title--small">请使用企业提供的工作台地址。</h1>
    <p className="site__lede">工作台地址形如 <code>/w/企业标识</code>，由企业管理员在邀请你时提供。</p>
  </section></main>;
}
