export interface MetaConfig {
  url: string;
  canonical?: string;
  name: string;
  title: string;
  description: string;
  themeColor: string;
  backgroundColor?: string;
  icons: {
    favicon: string;
    app: string;
    touchIcon: string;
    logo: string;
  };
  og: {
    locale: string;
    type: 'website' | 'article';
    image: string;
    width: number;
    height: number;
  };
  twitterHandle: string;
  email: {
    support: string;
  };
}

export const meta: MetaConfig = {
  url: 'https://atlas.box',
  canonical: 'https://atlas.box',
  name: 'Atlas',
  title: 'A framework for building reputation for communities',
  description: '',
  themeColor: '#000000',
  backgroundColor: '#ffffff',
  icons: {
    favicon: '/favicon.ico',
    app: '/brand/app.svg',
    touchIcon: '/apple-touch-icon.png',
    logo: '/brand/logomark.svg',
  },
  og: {
    locale: 'en-US',
    type: 'website',
    image: 'https://atlas.box/ogimage.png',
    width: 1200,
    height: 675,
  },
  twitterHandle: '@atlasdotbox',
  email: {
    support: 'support@atlas.box',
  },
}
