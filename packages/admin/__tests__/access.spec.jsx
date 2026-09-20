import React from 'react';
import { renderToString } from 'react-dom/server';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import Access from '../src/components/Access.jsx';
import Header from '../src/components/Header.jsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key, i18n: { language: 'en' } }),
  Trans: () => null,
}));

const render = (user, child) => {
  const state = { user };
  const store = { getState: () => state, subscribe: () => () => {}, dispatch: () => {} };
  return renderToString(
    <Provider store={store}>
      <MemoryRouter basename="/nested" initialEntries={['/nested/ui']}>
        {child}
      </MemoryRouter>
    </Provider>,
  );
};

describe('admin navigation permissions', () => {
  it.each([null, {}, { objectId: 'guest', type: 'guest' }])(
    'never renders protected children for an unauthorized account: %j',
    (user) => {
      const child = vi.fn(() => <div>Protected content</div>);
      const html = render(
        user,
        <Access meta={{ auth: 'administrator' }}>{React.createElement(child)}</Access>,
      );
      expect(child).not.toHaveBeenCalled();
      expect(html).not.toContain('Protected content');
    },
  );

  it('allows administrators and allows guests to view their profile', () => {
    expect(
      render(
        { objectId: 'admin', type: 'administrator' },
        <Access meta={{ auth: 'administrator' }}>Allowed</Access>,
      ),
    ).toContain('Allowed');
    expect(render({ objectId: 'guest', type: 'guest' }, <Access>Profile</Access>)).toContain(
      'Profile',
    );
  });

  it.each([
    [null, '/nested/ui/login'],
    [{ objectId: 'guest', type: 'guest' }, '/nested/ui/profile'],
    [{ objectId: 'admin', type: 'administrator' }, '/nested/ui'],
  ])('points the logo directly to the permitted page: %j', (user, destination) => {
    vi.stubGlobal('window', { SITE_NAME: 'Test' });
    try {
      const brand = render(user, <Header />).match(
        /<a\b[^>]*class="waline-brand-link"[^>]*>/u,
      )?.[0];
      expect(brand).toContain(`href="${destination}"`);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
