import type { CSSProperties } from 'react';
import { isDemoDeployment, siteEntry } from '../../lib/site-entry';
import { TilingStage } from '../../components/site/tiling-stage';
import { ClosingTile } from '../../components/site/closing-tile';

export const dynamic = 'force-dynamic';

// Site entry (ADR-0015). Plain <a> for the doors: they lead into other root layouts, which load as a full page.
const STEPS = [
  { title: '导入户型', body: '上传 DXF 图纸，自动识别墙体、门窗和房间；图片和 PDF 由企业整理后录入。' },
  { title: '生成方案', body: '选好要铺的地面、墙面和楼梯，挑几款石材，一次得到 3 个整体方案：石材、规格、铺法和软装风格各不相同。' },
  { title: '看清楚再确认', body: '俯看整层、走进房间，或切到平面图看铺贴排版；想换风格、换石材，调整后重新出图，满意再确认。' },
] as const;
const VIEWS = [
  { name: '全层立体浏览', body: '墙体剖开，一眼看清整层的软装与硬装。' },
  { name: '入户查看', body: '人眼视高走进房间，近看石材的纹理和光泽。' },
  { name: '平面图', body: '真实材质、白模、线框三种看法，铺贴排版一目了然。' },
] as const;
const rise = (index: number) => ({ '--rise': index } as CSSProperties);

function Door({ href, children, variant = 'primary' }: { href: string | null; children: React.ReactNode; variant?: 'primary' | 'quiet' | 'light' }) {
  return href ? <a className={`btn btn--${variant}`} href={href}>{children}<i aria-hidden="true">→</i></a>
    : <span className={`btn btn--${variant} btn--off`} aria-disabled="true">{children}</span>;
}

export default function SitePage() {
  const { enterprise, invalid } = siteEntry(), demo = isDemoDeployment();
  const client = enterprise ? `/c/${enterprise}` : null, workbench = enterprise ? `/w/${enterprise}` : null;
  return <div className="site">
    <header className="top">
      <a className="top__brand" href="/"><span className="mark" aria-hidden="true"/><b>Hestia</b><span>空间设计工作台</span></a>
      <nav className="top__nav" aria-label="页面导航">
        <a href="#how">怎么做</a><a href="#see">看效果</a><a href="#doors">入口</a>
        <Door href={workbench} variant="quiet">企业工作台</Door>
      </nav>
    </header>

    <main>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__copy">
          <p className="kicker" data-rise style={rise(0)}>石材硬装 · 软装 · 3D 方案</p>
          <h1 id="hero-title" className="hero__title" data-settle>一处空间，<br/>先把硬装与软装<br/>做一遍。</h1>
          <p className="hero__lede" data-rise style={rise(1)}>导入户型图纸，自动铺好地面与墙面的石材、配上整套软装，生成 3 个整体方案。在 3D 里走进每个房间看清楚，再决定。</p>
          <div className="hero__doors" data-rise style={rise(2)}>
            <Door href={client}>进入客户端</Door>
            <Door href={workbench} variant="quiet">我是企业成员</Door>
          </div>
          {!enterprise && (invalid && demo
            // A misconfigured demo says what is wrong rather than showing greyed-out doors.
            ? <p className="hero__note hero__note--error" role="alert">入口未接通：<code>HESTIA_HOME_ENTRY</code> 的值「{invalid}」无效，应为企业标识，例如 <code>demo-home</code>。改好后重启服务。</p>
            : <p className="hero__note">请使用合作企业提供的链接或分享码进入。</p>)}
        </div>
        <div className="hero__stage" data-rise style={rise(3)}><TilingStage/></div>
      </section>

      <section id="how" className="how" aria-labelledby="how-title">
        <h2 id="how-title" className="section-title">三步，从图纸到方案。</h2>
        <ol className="how__steps">
          {STEPS.map((step, i) => <li key={step.title} data-reveal style={{ '--reveal': i } as CSSProperties}>
            <span className="how__no">{String(i + 1).padStart(2, '0')}</span>
            <h3>{step.title}</h3><p>{step.body}</p>
          </li>)}
        </ol>
      </section>

      <section id="see" className="see" aria-labelledby="see-title">
        <div className="see__head">
          <h2 id="see-title" className="section-title">效果图之外，<br/>还能走进去看。</h2>
          <p>每个方案都有一张效果图，也有一个可以转、可以走进去的空间。软装换了风格、石材换了铺法，看到的都是同一份方案。</p>
        </div>
        <figure className="see__island" data-island>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/client/demo-villa-cover.jpg" alt="示例空间客厅效果图：石材地面与整套软装（示意）" width={1600} height={1000} loading="lazy" decoding="async"/>
          <figcaption>示例空间 · 效果图示意</figcaption>
        </figure>
        <ul className="see__views">
          {VIEWS.map((view, i) => <li key={view.name} data-reveal style={{ '--reveal': i } as CSSProperties}><b>{view.name}</b><span>{view.body}</span></li>)}
        </ul>
      </section>

      <section id="doors" className="doors" aria-labelledby="doors-title">
        <h2 id="doors-title" className="section-title">两扇门，同一份方案。</h2>
        <p className="doors__lede">客户的调整和确认，企业那边都能看到；企业预置好的方案，用一个分享码交到客户手里。</p>
        <div className="doors__grid">
          <article className="door-card" data-reveal style={{ '--reveal': 0 } as CSSProperties}>
            <small>业主 · 客户</small>
            <h3>看方案、提需求、做决定</h3>
            <ul><li>提交户型和石材偏好，得到 3 个整体方案</li><li>输入分享码，直接查看企业准备好的方案</li><li>换软装风格、换石材铺法，满意再确认</li></ul>
            <Door href={client} variant="light">进入客户端</Door>
          </article>
          <article className="door-card door-card--dark" data-reveal style={{ '--reveal': 1 } as CSSProperties}>
            <small>企业成员</small>
            <h3>跟进线索、出方案、分享</h3>
            <ul><li>客户提交的需求和图纸在一处跟进</li><li>为客户预置方案、出图，生成分享码</li><li>客户的调整、确认和留言一目了然</li></ul>
            <Door href={workbench} variant="light">进入企业工作台</Door>
          </article>
        </div>
      </section>

      <section className="close" aria-labelledby="close-title">
        <ClosingTile/>
        <h2 id="close-title" className="section-title">先铺一遍，再动工。</h2>
        <Door href={client}>进入客户端</Door>
      </section>
    </main>

    <footer className="foot">
      <span><b>Hestia</b> · 空间设计工作台</span>
      {demo && <span>演示环境 · 数据、尺寸与效果图均为示意</span>}
    </footer>
  </div>;
}
