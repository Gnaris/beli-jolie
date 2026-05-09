export type ProductsListFilters = {
  q?:           string;
  cat?:         string;
  subcat?:      string;
  collection?:  string;
  color?:       string;
  tag?:         string;
  composition?: string;
  bestseller?:  string;
  new?:         string;
  promo?:       string;
  ordered?:     string;
  notOrdered?:  string;
  hideOos?:     string;
  minPrice?:    string;
  maxPrice?:    string;
};

export function buildLoadMoreQuery(
  filters: ProductsListFilters,
  page: number,
  locale: string,
): string {
  const params = new URLSearchParams();
  if (filters.q)           params.set("q",           filters.q);
  if (filters.cat)         params.set("cat",         filters.cat);
  if (filters.subcat)      params.set("subcat",      filters.subcat);
  if (filters.collection)  params.set("collection",  filters.collection);
  if (filters.color)       params.set("color",       filters.color);
  if (filters.tag)         params.set("tag",         filters.tag);
  if (filters.composition) params.set("composition", filters.composition);
  if (filters.bestseller)  params.set("bestseller",  filters.bestseller);
  if (filters.new)         params.set("new",         filters.new);
  if (filters.promo)       params.set("promo",       filters.promo);
  if (filters.ordered)     params.set("ordered",     filters.ordered);
  if (filters.notOrdered)  params.set("notOrdered",  filters.notOrdered);
  if (filters.hideOos)     params.set("hideOos",     filters.hideOos);
  if (filters.minPrice)    params.set("minPrice",    filters.minPrice);
  if (filters.maxPrice)    params.set("maxPrice",    filters.maxPrice);
  if (locale)              params.set("locale",      locale);
  params.set("page", String(page));
  return params.toString();
}

export type LoadMoreUiState = {
  showLoadMoreButton: boolean;
  showAllShownMessage: boolean;
  showErrorBlock: boolean;
};

export function getLoadMoreUiState(input: {
  hasMore:       boolean;
  loadError:     string | null;
  productCount:  number;
}): LoadMoreUiState {
  const { hasMore, loadError, productCount } = input;
  return {
    showLoadMoreButton:  hasMore && !loadError,
    showAllShownMessage: !hasMore && productCount > 0,
    showErrorBlock:      Boolean(loadError),
  };
}
