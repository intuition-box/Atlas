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
    logo: string;
    logomark: string;
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
  url: 'https://example.com',
  canonical: 'https://example.com',
  name: 'Orbyt',
  title: '',
  description: '',
  themeColor: '#000000',
  backgroundColor: '#ffffff',
  icons: {
    favicon: '/favicon.ico',
    app: '/app.svg',
    logo: '/brand/logo.svg',
    logomark: '/brand/logomark.svg',
  },
  og: {
    locale: 'en-US',
    type: 'website',
    image: 'https://example.com/ogimage.png',
    width: 1200,
    height: 675,
  },
  twitterHandle: '@orbyt',
  email: {
    support: 'support@example.com',
  },
}
