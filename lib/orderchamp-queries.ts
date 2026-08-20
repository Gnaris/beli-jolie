/**
 * Orderchamp GraphQL — queries et mutations validées par introspection réelle
 * du schéma le 2026-08-19 (compte PRINCESSE, contact@beliandjolie.com).
 *
 * Endpoint : POST https://api.orderchamp.com/v1/graphql
 * Auth     : Authorization: Bearer <token>
 *
 * Particularités validées :
 *  - Toutes les collections (variants, images, collections…) sont Relay-style :
 *    il FAUT passer `first: N` ou `last: N`, sinon erreur GraphQL.
 *  - `ProductImage.originalUrl` (pas `url`, pas `sourceUrl` en output).
 *  - Mutations : nom singulier + `(input: XXXInput!)` — ex `productCreate`,
 *    `productVariantCreate` (pas `variantCreate`), `inventoryLevelAdjust`
 *    (pas `inventoryAdjust`).
 *  - `UserError` a `field` (LIST), `message`, `name` — pas de `code`.
 *  - `Product.category` = `Category { id name path rawPath }`, `path` est un
 *    enum `CategoryPath` (1600+ valeurs, ex : `JEWELRY_ACCESSORIES_BRACELETS`).
 *  - Statut/publish : pas de champ `status` ou `published` sur `Product` — le
 *    statut de publication est exposé via `Product.listing`.
 *  - `Money` = SCALAR (accepte number en input, retourne string ex "4.50").
 */

// ─── Fragments ──────────────────────────────────────────────────────────────

/** Champs cœur d'un produit — inclut les connections Relay avec pagination. */
export const PRODUCT_FIELDS_FRAGMENT = /* GraphQL */ `
  fragment ProductFields on Product {
    id
    databaseId
    title
    description
    brand
    madeIn
    hsCode
    caseQuantity
    minimumOrderQuantity
    option1
    option2
    option3
    weight
    length
    width
    height
    createdAt
    updatedAt
    contentUpdatedAt
    customCategory {
      id
      label
    }
    images(first: 50) {
      edges {
        node {
          id
          databaseId
          originalUrl
          thumbnailUrl
          transformedUrl
          position
        }
      }
    }
    variants(first: 100) {
      edges {
        node {
          id
          databaseId
          sku
          barcode
          ean
          price
          msrp
          inventoryQuantity
          inventoryPolicy
          option1
          option2
          option3
          weight
          length
          width
          height
        }
      }
    }
  }
`;

/** Fragment commande — inclut adresse livraison + items via Relay.
 *  ⚠️ Pas de `databaseId` sur `Order` (contrairement à Product) — le schéma OC
 *  ne l'expose pas et le demander fait planter la query. */
export const ORDER_FIELDS_FRAGMENT = /* GraphQL */ `
  fragment OrderFields on Order {
    id
    reference
    status
    createdAt
    updatedAt
    total
    subtotal
    currency
    retailer {
      id
      name
      email
    }
    shippingAddress {
      firstName
      lastName
      company
      street
      city
      postalCode
      countryCode
      phone
    }
    products(first: 100) {
      edges {
        node {
          id
          sku
          title
          quantity
          price
        }
      }
    }
  }
`;

// ─── Queries ────────────────────────────────────────────────────────────────

export const ACCOUNT_QUERY = /* GraphQL */ `
  query Account {
    account {
      id
      databaseId
      name
      email
    }
  }
`;

export const PRODUCT_QUERY = /* GraphQL */ `
  ${PRODUCT_FIELDS_FRAGMENT}
  query Product($id: ID!) {
    product(id: $id) {
      ...ProductFields
    }
  }
`;

export const PRODUCTS_LIST_QUERY = /* GraphQL */ `
  ${PRODUCT_FIELDS_FRAGMENT}
  query Products($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        cursor
        node {
          ...ProductFields
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const ORDER_QUERY = /* GraphQL */ `
  ${ORDER_FIELDS_FRAGMENT}
  query Order($id: ID!) {
    order(id: $id) {
      ...OrderFields
    }
  }
`;

export const ORDERS_LIST_QUERY = /* GraphQL */ `
  ${ORDER_FIELDS_FRAGMENT}
  query Orders($first: Int!, $after: String) {
    orders(first: $first, after: $after) {
      edges {
        cursor
        node {
          ...OrderFields
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// ─── Mutations produits ─────────────────────────────────────────────────────

export const PRODUCT_CREATE_MUTATION = /* GraphQL */ `
  ${PRODUCT_FIELDS_FRAGMENT}
  mutation ProductCreate($input: ProductCreateInput!) {
    productCreate(input: $input) {
      product {
        ...ProductFields
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_UPDATE_MUTATION = /* GraphQL */ `
  ${PRODUCT_FIELDS_FRAGMENT}
  mutation ProductUpdate($input: ProductUpdateInput!) {
    productUpdate(input: $input) {
      product {
        ...ProductFields
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_DELETE_MUTATION = /* GraphQL */ `
  mutation ProductDelete($input: ProductDeleteInput!) {
    productDelete(input: $input) {
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_PUBLISH_MUTATION = /* GraphQL */ `
  mutation ProductPublish($input: ProductPublishInput!) {
    productPublish(input: $input) {
      product {
        id
        listing {
          id
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_UNPUBLISH_MUTATION = /* GraphQL */ `
  mutation ProductUnpublish($input: ProductUnpublishInput!) {
    productUnpublish(input: $input) {
      product {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_REPUBLISH_MUTATION = /* GraphQL */ `
  mutation ProductRepublish($input: ProductRepublishInput!) {
    productRepublish(input: $input) {
      product {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ─── Mutations variantes ────────────────────────────────────────────────────

export const PRODUCT_VARIANT_CREATE_MUTATION = /* GraphQL */ `
  mutation ProductVariantCreate($input: ProductVariantCreateInput!) {
    productVariantCreate(input: $input) {
      productVariant {
        id
        databaseId
        sku
        price
        msrp
        inventoryQuantity
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_VARIANT_UPDATE_MUTATION = /* GraphQL */ `
  mutation ProductVariantUpdate($input: ProductVariantUpdateInput!) {
    productVariantUpdate(input: $input) {
      productVariant {
        id
        sku
        price
        msrp
        inventoryQuantity
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_VARIANT_DELETE_MUTATION = /* GraphQL */ `
  mutation ProductVariantDelete($input: ProductVariantDeleteInput!) {
    productVariantDelete(input: $input) {
      userErrors {
        field
        message
      }
    }
  }
`;

// ─── Mutations stock ────────────────────────────────────────────────────────

export const INVENTORY_LEVEL_ADJUST_MUTATION = /* GraphQL */ `
  mutation InventoryLevelAdjust($input: InventoryLevelAdjustInput!) {
    inventoryLevelAdjust(input: $input) {
      userErrors {
        field
        message
      }
    }
  }
`;

export const INVENTORY_LEVEL_BULK_ADJUST_MUTATION = /* GraphQL */ `
  mutation InventoryLevelBulkAdjust($input: InventoryLevelBulkAdjustInput!) {
    inventoryLevelBulkAdjust(input: $input) {
      userErrors {
        field
        message
      }
    }
  }
`;

// ─── Mutations webhooks (push commandes) ────────────────────────────────────

export const WEBHOOK_CREATE_MUTATION = /* GraphQL */ `
  mutation WebhookCreate($input: WebhookCreateInput!) {
    webhookCreate(input: $input) {
      webhook {
        id
        topic
        endpoint
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const WEBHOOK_DELETE_MUTATION = /* GraphQL */ `
  mutation WebhookDelete($input: WebhookDeleteInput!) {
    webhookDelete(input: $input) {
      userErrors {
        field
        message
      }
    }
  }
`;

// ─── Mutations catégories custom ────────────────────────────────────────────

export const CUSTOM_CATEGORY_CREATE_MUTATION = /* GraphQL */ `
  mutation CustomCategoryCreate($input: CustomCategoryCreateInput!) {
    customCategoryCreate(input: $input) {
      customCategory {
        id
        label
        value
        isPublished
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const CUSTOM_CATEGORY_UPDATE_MUTATION = /* GraphQL */ `
  mutation CustomCategoryUpdate($input: CustomCategoryUpdateInput!) {
    customCategoryUpdate(input: $input) {
      customCategory {
        id
        label
        isPublished
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const CUSTOM_CATEGORIES_QUERY = /* GraphQL */ `
  query CustomCategories($first: Int!) {
    customCategories(first: $first) {
      edges {
        node {
          id
          label
          value
          isPublished
        }
      }
    }
  }
`;

/**
 * Liste les storefronts (vitrines de la marque). Généralement 1 seule par
 * compte fournisseur. L'ID est nécessaire à `productPublish` pour publier
 * sur la bonne vitrine.
 */
export const STOREFRONTS_QUERY = /* GraphQL */ `
  query Storefronts($first: Int!) {
    storefronts(first: $first) {
      edges {
        node {
          id
          name
          slug
          isPublished
        }
      }
    }
  }
`;

// ─── Mutations commandes ────────────────────────────────────────────────────

export const ORDER_CONFIRM_MUTATION = /* GraphQL */ `
  mutation OrderConfirm($input: OrderConfirmInput!) {
    orderConfirm(input: $input) {
      order {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const ORDER_CANCEL_MUTATION = /* GraphQL */ `
  mutation OrderCancel($input: OrderCancelInput!) {
    orderCancel(input: $input) {
      order {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const SHIPMENT_CREATE_MUTATION = /* GraphQL */ `
  mutation ShipmentCreate($input: ShipmentCreateInput!) {
    shipmentCreate(input: $input) {
      shipment {
        id
        trackingNumber
      }
      userErrors {
        field
        message
      }
    }
  }
`;
