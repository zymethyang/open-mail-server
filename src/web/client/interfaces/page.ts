export interface Page {
  matches(route: string, role: string): boolean;
  render(route: string): Promise<void>;
}
