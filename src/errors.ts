export class SlideGenError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SlideGenError";
  }
}

export class BrowserError extends SlideGenError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BrowserError";
  }
}

export class FontError extends SlideGenError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FontError";
  }
}

export class PptxBuildError extends SlideGenError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PptxBuildError";
  }
}

export class RenderError extends SlideGenError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RenderError";
  }
}
