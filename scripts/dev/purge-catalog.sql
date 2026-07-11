-- Purge du catalogue local avant import des 500 produits prod.
-- Préserve : User, SiteConfig, CompanyInfo, LegalDocument, Order/OrderItem (snapshot), Claim, Cart (mais pas CartItem).

SET FOREIGN_KEY_CHECKS=0;

-- Enfants directs de Product / ProductColor / PackColorLine
TRUNCATE TABLE PackColorLineSize;
TRUNCATE TABLE PackColorLine;
TRUNCATE TABLE VariantSize;
TRUNCATE TABLE ProductColorImage;
TRUNCATE TABLE StockMovement;
TRUNCATE TABLE PriceHistory;
TRUNCATE TABLE RestockAlert;
TRUNCATE TABLE CartItem;
TRUNCATE TABLE ProductColor;

-- Enfants directs de Product
TRUNCATE TABLE Favorite;
TRUNCATE TABLE ProductComposition;
TRUNCATE TABLE ProductTag;
TRUNCATE TABLE ProductTranslation;
TRUNCATE TABLE ProductSimilar;
TRUNCATE TABLE ProductBundle;
TRUNCATE TABLE PendingSimilar;
TRUNCATE TABLE ProductView;
TRUNCATE TABLE TranslationJob;
TRUNCATE TABLE ImageProcessingJob;
TRUNCATE TABLE AnkorstoreOperation;
TRUNCATE TABLE MarketplaceRefreshJob;
TRUNCATE TABLE EfashionShootingBatchItem;
TRUNCATE TABLE PromotionProduct;
TRUNCATE TABLE CatalogProduct;
TRUNCATE TABLE _ProductSubCategories;
TRUNCATE TABLE CollectionProduct;
TRUNCATE TABLE Product;

-- Refs et enfants de refs
TRUNCATE TABLE Collection;
TRUNCATE TABLE CollectionTranslation;
TRUNCATE TABLE PromotionCollection;
TRUNCATE TABLE PromotionCategory;

TRUNCATE TABLE TagTranslation;
TRUNCATE TABLE Tag;

TRUNCATE TABLE SubCategoryTranslation;
TRUNCATE TABLE SubCategory;
TRUNCATE TABLE CategoryTranslation;
TRUNCATE TABLE Category;

TRUNCATE TABLE ColorTranslation;
TRUNCATE TABLE Color;

TRUNCATE TABLE CompositionTranslation;
TRUNCATE TABLE Composition;

TRUNCATE TABLE SeasonTranslation;
TRUNCATE TABLE Season;

TRUNCATE TABLE Size;
TRUNCATE TABLE HsCode;
TRUNCATE TABLE ManufacturingCountryTranslation;
TRUNCATE TABLE ManufacturingCountry;

SET FOREIGN_KEY_CHECKS=1;

SELECT '=== Purge OK ===' AS status;
