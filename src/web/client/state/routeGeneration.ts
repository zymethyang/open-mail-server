let routeGeneration = 0;

export function startRoute(): number {
  routeGeneration += 1;
  return routeGeneration;
}

export function currentRouteGeneration(): number {
  return routeGeneration;
}
