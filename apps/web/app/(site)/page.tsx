import { isDemoDeployment, siteEnterprise } from '../../lib/site-entry';

export const dynamic = 'force-dynamic';

export default function SitePage() {
  const enterprise = siteEnterprise(), demo = isDemoDeployment();
  const doors = [
    { kicker: '业主 · 客户', title: '查看与确认我的方案', text: '提交户型和石材偏好，得到 3 个整体方案；也可以输入企业给你的分享码直接查看。',
      href: enterprise ? `/c/${enterprise}` : null, action: '进入客户端' },
    { kicker: '企业成员', title: '进入企业工作台', text: '跟进客户线索，预置方案、出图并分享给客户，查看客户的确认与留言。',
      href: enterprise ? `/w/${enterprise}` : null, action: '进入工作台' },
  ];
  return <main className="site">
    <figure className="site__cover">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/client/demo-villa-cover.jpg" alt="示例空间客厅效果图（示意）"/>
      <figcaption>示例空间 · 效果图示意</figcaption>
    </figure>
    <section className="site__body">
      <header className="site__brand"><span className="site__mark">Hestia</span><span>空间设计工作台</span></header>
      <h1 className="site__title">一处空间，<br/>先把硬装与软装<br/>做一遍。</h1>
      <p className="site__lede">导入户型图纸，由设计助手完成布局、风格与石材铺贴，在 3D 里走进每个房间，再出效果图。企业与客户在同一份方案上沟通、调整和确认。</p>
      <nav className="site__doors" aria-label="入口">
        {doors.map(door => door.href
          // Plain links: the doors lead into other root layouts (client, workbench), which always load as a full page;
          // next/link's client navigation adds nothing there and can swallow the click if its fetch fails.
          ? <a key={door.title} className="door" href={door.href}>
              <small>{door.kicker}</small><b>{door.title}</b><span>{door.text}</span><em>{door.action} <i aria-hidden="true">→</i></em>
            </a>
          : <div key={door.title} className="door door--off" aria-disabled="true">
              <small>{door.kicker}</small><b>{door.title}</b><span>{door.text}</span><em>请使用合作企业提供的链接或分享码进入</em>
            </div>)}
      </nav>
      {demo && <p className="site__fine">演示环境 · 数据、尺寸与效果图均为示意</p>}
    </section>
  </main>;
}
