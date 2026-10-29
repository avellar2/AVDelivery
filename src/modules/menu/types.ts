export type MenuCategory = {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
  productCount: number;
};

export type MenuProduct = {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  description: string | null;
  priceCents: number;
  imagePath: string | null;
  imageUrl: string | null;
  available: boolean;
  sortOrder: number;
  optionGroupIds: string[];
};

export type MenuOption = {
  id: string;
  name: string;
  additionalPriceCents: number;
  available: boolean;
  sortOrder: number;
};

export type MenuGroupAssociation = {
  productId: string;
  productName: string;
  sortOrder: number;
};

export type MenuOptionGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  active: boolean;
  availableOptionsCount: number;
  options: MenuOption[];
  associations: MenuGroupAssociation[];
};

export type MenuManagementData = {
  categories: MenuCategory[];
  products: MenuProduct[];
  optionGroups: MenuOptionGroup[];
};

export type PublicMenuOption = {
  id: string;
  name: string;
  additionalPriceCents: number;
};

export type PublicMenuOptionGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  options: PublicMenuOption[];
};

export type PublicMenuProduct = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  imageUrl: string | null;
  optionGroups: PublicMenuOptionGroup[];
};

export type PublicMenuCategory = {
  id: string;
  name: string;
  description: string | null;
  products: PublicMenuProduct[];
};

export type PublicMenuStore = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  phone: string | null;
  logoUrl: string | null;
};

export type PublicMenu = {
  store: PublicMenuStore;
  categories: PublicMenuCategory[];
};
