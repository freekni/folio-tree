import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Folio Tree',
  description: '로컬 파일 기반 프로젝트 문서 관리 도구',
  metadataBase: new URL('https://freekni.github.io/folio-tree/'),
  openGraph: {
    title: 'Folio Tree',
    description: '프로젝트를 폴더처럼, 내용은 문서처럼.',
    images: ['/folio-tree/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Folio Tree',
    description: '프로젝트를 폴더처럼, 내용은 문서처럼.',
    images: ['/folio-tree/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
