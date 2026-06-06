/* eslint-disable */
import * as Router from 'expo-router';

export * from 'expo-router';

declare module 'expo-router' {
  export namespace ExpoRouter {
    export interface __routes<T extends string | object = string> {
      hrefInputParams: { pathname: Router.RelativePathString, params?: Router.UnknownInputParams } | { pathname: Router.ExternalPathString, params?: Router.UnknownInputParams } | { pathname: `/`; params?: Router.UnknownInputParams; } | { pathname: `/_sitemap`; params?: Router.UnknownInputParams; } | { pathname: `${'/(app)'}` | `/`; params?: Router.UnknownInputParams; } | { pathname: `${'/(auth)'}/code` | `/code`; params?: Router.UnknownInputParams; } | { pathname: `${'/(auth)'}/phone` | `/phone`; params?: Router.UnknownInputParams; } | { pathname: `${'/(app)'}/ride/[id]` | `/ride/[id]`, params: Router.UnknownInputParams & { id: string | number; } };
      hrefOutputParams: { pathname: Router.RelativePathString, params?: Router.UnknownOutputParams } | { pathname: Router.ExternalPathString, params?: Router.UnknownOutputParams } | { pathname: `/`; params?: Router.UnknownOutputParams; } | { pathname: `/_sitemap`; params?: Router.UnknownOutputParams; } | { pathname: `${'/(app)'}` | `/`; params?: Router.UnknownOutputParams; } | { pathname: `${'/(auth)'}/code` | `/code`; params?: Router.UnknownOutputParams; } | { pathname: `${'/(auth)'}/phone` | `/phone`; params?: Router.UnknownOutputParams; } | { pathname: `${'/(app)'}/ride/[id]` | `/ride/[id]`, params: Router.UnknownOutputParams & { id: string; } };
      href: Router.RelativePathString | Router.ExternalPathString | `/${`?${string}` | `#${string}` | ''}` | `/_sitemap${`?${string}` | `#${string}` | ''}` | `${'/(app)'}${`?${string}` | `#${string}` | ''}` | `/${`?${string}` | `#${string}` | ''}` | `${'/(auth)'}/code${`?${string}` | `#${string}` | ''}` | `/code${`?${string}` | `#${string}` | ''}` | `${'/(auth)'}/phone${`?${string}` | `#${string}` | ''}` | `/phone${`?${string}` | `#${string}` | ''}` | { pathname: Router.RelativePathString, params?: Router.UnknownInputParams } | { pathname: Router.ExternalPathString, params?: Router.UnknownInputParams } | { pathname: `/`; params?: Router.UnknownInputParams; } | { pathname: `/_sitemap`; params?: Router.UnknownInputParams; } | { pathname: `${'/(app)'}` | `/`; params?: Router.UnknownInputParams; } | { pathname: `${'/(auth)'}/code` | `/code`; params?: Router.UnknownInputParams; } | { pathname: `${'/(auth)'}/phone` | `/phone`; params?: Router.UnknownInputParams; } | `${'/(app)'}/ride/${Router.SingleRoutePart<T>}` | `/ride/${Router.SingleRoutePart<T>}` | { pathname: `${'/(app)'}/ride/[id]` | `/ride/[id]`, params: Router.UnknownInputParams & { id: string | number; } };
    }
  }
}
