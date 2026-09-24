// Types of the AFM module (js/src/index.js, JavaScript until every widget
// view is converted to TypeScript).
import type { AnyModel } from "./core/model.js";

type Cleanup = (() => void) | undefined;

declare const widget: {
  initialize(context: { model: AnyModel<any> }): Cleanup;
  render(context: { model: AnyModel<any>; el: HTMLElement }): Cleanup;
};
export default widget;
