# Faire API — dump complet
Source : https://developers.faire.com/docs
Date : 2026-06-15T12:33:08.571Z
Fragments : 88

---

## OVERVIEW — Faire - Developers

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
Prepacks
Product Variants
Products
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
Faire External API
Export
v1.0.0
API Base URL
Production server:
https://www.faire.com/external-api/v2
Security
API Key (OAuth) & API Key (AppCredentials)

API Key (OAuth)

OAuth access token obtained through the Authorization Code Grant flow. Must be used together with X-FAIRE-APP-CREDENTIALS header.

An API key is a token that you provide when making API calls. Include the token in a header parameter called X-FAIRE-OAUTH-ACCESS-TOKEN.

Example: X-FAIRE-OAUTH-ACCESS-TOKEN: 123

API Key (AppCredentials)

Base64-encoded applicationId:applicationSecret. Must be used together with X-FAIRE-OAUTH-ACCESS-TOKEN header for OAuth authentication.

An API key is a token that you provide when making API calls. Include the token in a header parameter called X-FAIRE-APP-CREDENTIALS.

Example: X-FAIRE-APP-CREDENTIALS: 123

The Faire External API allows brands and integration partners to programmatically access and manage their data on Faire, including products, orders, inventory, and more.

Authentication

OAuth 2.0 is the recommended authorization method for accessing the Faire External API, especially for integration partners working with multiple brands. OAuth uses an Authorization Code Grant flow that allows applications to obtain an access token on behalf of a Faire user without requiring them to share credentials.

To use OAuth, you'll need to:

Register your application in the Faire Developer Portal to get an applicationId and applicationSecret
Redirect users to Faire's authorization page to grant specific permissions (scopes)
Exchange the authorization code for an OAuth access token
Include both X-FAIRE-APP-CREDENTIALS (Base64-encoded applicationId:applicationSecret) and X-FAIRE-OAUTH-ACCESS-TOKEN headers in API requests
Key Definitions
Product Definition

A product is a category of similar physical items that are differentiated by their options. An example product could be a Faire-branded sweatshirt. The sweatshirt may come in different sizes and colors. The product itself represents the kind of product, but not a specific variant.

Option Definition

An option is a variable attribute that a product has. An example might be size or color. Options are defined with an option name and several option values. A "color" option could have "red", "blue", and "yellow", for example. In this example, the option name is "color" and the option values are "red", "blue", and "yellow".

Variant Definition

A variant is a specific combination of option values. For example, for a Faire-branded sweatshirt product with "size" and "color" options, a large, red Faire-branded sweatshirt would be a variant. Variants represent an actual physical item and have pricing, unique skus, and inventory.

Using OAuth

OAuth is the recommended authorization process for accessing Faire's External API. However, if you are a single brand seeking access to Faire's APIs, we suggest generating the access token yourself in the Brand Portal. For integration partners with multiple brands, we recommend utilizing OAuth for authorization.

OAuth

OAuth (in this case OAuth 2.0) which stands for “Open Authorization”, is a standard designed to allow a website or application to access resources hosted by other web apps on behalf of a user.
The Faire OAuth API lets applications request and obtain permissions from a Faire account to make API calls on behalf of that account. By using OAuth, applications are able to receive an access token without relying on the Faire user to provide it to them.

Authorization Code

Faire uses an "Authorization Code Grant" flow where external partner applications obtain an authorization code that is then redeemed to get an access token. This token can then be used for authorization when calling Faire APIs.

To start the flow, navigate the Faire user to the OAuth authorization page. On this page, the user is able to view a list of permissions that your application is trying to obtain. If the user decides to authorize the application, an authorization code is returned. If the user does not authorize the application, the user is redirected back to your website.

OAuth permission URL

To access the authorization page, the user needs to be redirected to a URL of the following format: https://faire.com/oauth2/authorize?applicationId={YOUR_APP_ID}&scope=SPECIFIC_PERMISSION&state=82201dd8d83d23cc8a48caf52&redirectUrl=https://example.com.

Query String Parameters

All the required parameters are provided in the form of a query string. Below, you can find a detailed description of all the parameters that you need to build the OAuth permission URL:

FIELD	DESCRIPTION	REQUIRED
applicationId
string	The identifier that is assigned to your application. You can find it in the Developer Portal.	Yes
scope
string[]	A list of the permissions that your application requests. For more information on permissions, refer to the section below.	Yes
state
string	This parameter serves as a CSRF protection mechanism. When the user gets redirected back, you can verify that the state value matches what it was set originally.	Yes
redirectUrl
string	This is the URL to which the Faire user will be redirected to after the authorization is complete.	Yes
Permissions

Applications must provide a list of specific permissions that they want to access from Faire user. Below you can find the list of different permissions that you can specify:

STATE	DESCRIPTION
READ_PRODUCTS	Fetch product information.
WRITE_PRODUCTS	Add, update, or delete product information.
READ_ORDERS	Fetch order information.
WRITE_ORDERS	Add, update, or delete order information.
READ_BRAND	Fetch brand information.
READ_RETAILER	Fetch retailer information.
READ_INVENTORIES	Fetch inventory information.
WRITE_INVENTORIES	Add, update, or delete inventory information.
READ_SHIPMENTS	Fetch shipments information.
READ_REVIEWS	Fetch product review information.
Response

Once the Faire user authorizes the application, the authorizationCode and state are passed in as query parameters in the provided redirectUrl.

Keep in mind that the authorization code expires within 10 minutes. If you do not exchange it for the token within the allotted time, you will need to start the flow over again.

Access Token

As mentioned above, once you receive an authorization code you can exchange it for an OAuth access token. Use the access token to make authorized requests on behalf of the Faire user.

Sample request:

{
  "application_token": "YOUR_APP_ID",
  "application_secret": "YOUR_APP_SECRET",
  "redirect_url": "YOUR_REDIRECT_URL",
  "scope": ["PERMISSION_1", "PERMISSION_2"],
  "grant_type": "AUTHORIZATION_CODE",
  "authorization_code": "YOUR_CODE"
}
HTTP Request

POST https://www.faire.com/api/external-api-oauth2/token

Request Parameters
FIELD	DESCRIPTION	REQUIRED
applicationId	The identifier that is assigned to your application. You can access it in the Developer Portal.	Yes
applicationSecret	The secret identifier that is assigned to your application. You can access it in the Developer Portal. Please make sure to keep this data private and do not share it with other parties.	Yes
scope	A list of the permissions that your application requests. This list must match the previously provided scope parameter.	Yes
grantType	The grant identifier. In this iteration of OAuth, you would need to set it to AUTHORIZATION_CODE.	Yes
redirectUrl	This is the URL which you provided earlier. This url must match the previously provided redirect url.	Yes
authorizationCode	This is the authorization code which you were able to receive earlier.	Yes
Response

Sample response

{
  "access_token": "OAUTH_ACCESS_TOKEN",
  "token_type": "BEARER"
}
Using OAuth Access Token

A major difference between OAuth tokens and the access tokens used for V1 and V2 of the Faire External Api is that OAuth access tokens are used only for authorization, not authentication. In order to make requests you would need to use the following headers:

HEADER	DESCRIPTION	REQUIRED
X-FAIRE-APP-CREDENTIALS	The applicationId:applicationSecret encoded in the Base64 format.	Yes
X-FAIRE-OAUTH-ACCESS-TOKEN	The OAuth access token.	Yes

Only by using these two headers together, you are able to make requests and access resources at Faire.

Please note that OAuth is only enabled for External Api V2+ - you cannot send External V1 requests using OAuth access tokens.

Revoking OAuth Access Token

If by any chance you lose any confidential information about the application, you can easily revoke the OAuth access token to prevent it from being used by some other party. To do this you can make the POST request to the following endpoint \revoke

Sample request:

{
  "application_token": "YOUR_APP_ID",
  "application_secret": "YOUR_APP_SECRET",
  "access_token_o_auth": "YOUR_TOKEN"
}
HTTP Request

POST https://www.faire.com/api/external-api-oauth2/revoke

Request Parameters
FIELD	DESCRIPTION	REQUIRED
applicationToken	The identifier that is assigned to your application. You can access it in the Developer Portal.	Yes
applicationSecret	The secret identifier that is assigned to your application. You can access it in the Developer Portal. Please make sure to keep this data private and do not share it with other parties.	Yes
accessTokenOAuth	This is the OAuth token that you want to get revoked.	Yes
Response

Sample response

{
  "success": "true"
}
Idempotency

An idempotent operation can be applied multiple times without changing the result. Many of Faire's APIs have a mechanism to allow for idempotent operations.

Imagine you are trying to create a product and then the network connection fails after we create the product in Faire, but before we can return the results to you. You see it as a failure and might try to create the product again. Without idempotent operations, there are now 2 duplicate products in Faire!

The Faire APIs require an idempotency_token when creating new objects in our system. This token can be any string of characters and should be unique to the object you are creating. With the idempotency token, you can retry failed requests without risk of duplicating data in our system.

Changelog
2025-11
Added Update Product Prices by Product Variant IDs endpoint to update product variant prices in batch
Added Update Product Prices by SKUs endpoint to update product variant prices by SKU in batch
Added has_pending_retailer_cancellation_request to orders
Added shipping_label_url to shipments
Added View Packing Slip PDF endpoint to retrieve PDF packing slips for brand orders
Added made_in_country to products
Added case_measurements to product variants
2025-10
Added original_order_id query parameter to filter orders by original order ID in the Get all Orders endpoint
Added notes to orders
Added is_insider to retailers
2025-09
Added purchase_order_number to orders
2025-06
Added estimated_payout_at to orders
2024-11
Added is_free_shipping, free_shipping_reason and faire_covered_shipping_cost to orders
Added shipping_type to shipments
2024-09
Added total_brand_discounts and subtotal_after_brand_discounts to payout costs
2024-05
Add address_type field to addresses
2024-03
Added new page for new product variant inventory endpoints and deprecated old endpoints
2023-06
Added payout_flat_fee and commission_flat_fee, updated payout_fee and commission to payout costs
2023-05
Added OAuth flow documentation including how to create authorization codes, create access tokens and revoke access tokens.
Added support for cursor pagination on get all orders and get all products endpoints
2023-04
Added endpoints for removing an image from a product and removing an image from a variant.
2023-03
Documented the PENDING_RETAILER_CONFIRMATION state for orders and order items. Orders in this state are now returned from the Get all Orders endpoint.
Added support for creating prepacks in batches using the Add Multiple Prepacks to a Product endpoint.
Added documentation for canceling an order using the Cancel an Order endpoint.
Added support for uploading images to be used by products/variants.
2023-02
Added state field to order items and documented the possible states.
Added support for measurements for product variants.
2023-01
Added several fields to payout costs
2022-11
Added brand_discounts field to orders and discounts to order items
2022-10-14
Update product variant pricing geo constraint country and country_group restraints
2021-04-26
Added support for open pack products via per_style_minimum_order_quantity
2021-04-14
Added support for geographic pricing for product variants.
Deprecated retailer_price_cents and wholesale_price_cents
2021-04-07
Adjusted the maximum length of product short_description and description to match with brand portal
2021-03-17
Fixed incorrect unit_multiplier and minimum_order_quantity values in sample requests and responses under product endpoints
Added missing request parameter minimum_order_quantity to create and patch product endpoints
2021-03-15
Added preorder details in create and patch product endpoints
2021-03-10
We noticed prepacks shouldn't have any images, and we removed the field image from all requests and responses under that section.
2021-03-01
External API V2 was released
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/paths/orders-order_id--cancel/put

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
Product Variants
Products
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
PUT /orders/{order_id}/cancel
PUT
https://www.faire.com/external-api/v2/orders/{order_id}/cancel

This endpoint cancels an order and places it in the state CANCELED. The order can be canceled only if it has a state of NEW, PROCESSING, PENDING_RETAILER_CONFIRMATION or BACKORDERED.

Request
Security: API Key (OAuth) & API Key (AppCredentials)
Path Parameters
order_id
string
required
Body
application/json
application/json

Request to cancel an order, including the reason and an optional note.

note
string

A note explaining to the retailer why their order was canceled. The note must be between 30 and 1000 characters long.

reason
string

The reason for canceling the order.

Allowed values:
REQUESTED_BY_RETAILER
RETAILER_NOT_GOOD_FIT
CHANGE_REPLACE_ORDER
ITEM_OUT_OF_STOCK
INCORRECT_PRICING
ORDER_TOO_SMALL
REJECT_INTERNATIONAL_ORDER
OTHER
Responses
200
400
401
404
405
429
500
503

Successful response

Body
application/json
application/json
responses
/
200

Internally maps to a brand order.

id
string

Read-only. A unique identifier of the order, beginning with "bo_". NOTE: When shown on the Faire website, the "bo_" will be stripped and the order ID will be upper-case. e.g. "bo_bxdmjbwxid" appears as "#BXDMJBWXID" (See display_id).

Example:
bo_bxdmjbwxid
display_id
string

Read-only. The order identifier as displayed on the Faire website, emails, etc.

Example:
BXDMJBWXID
created_at
string

Read-only. An ISO 8601 timestamp of when the order was created.

Example:
2019-03-15T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 timestamp of when the order was last updated.

Example:
2019-03-15T00:10:00.000Z
state
string

The current state of the order.

Allowed values:
NEW
PROCESSING
PRE_TRANSIT
IN_TRANSIT
DELIVERED
CANCELED
BACKORDERED
PENDING_RETAILER_CONFIRMATION
items
array[object]

A list of order items associated with the order.

id
string

Read-only. A unique identifier of the order item, beginning with "oi_".

Example:
oi_bq425ju5vh
created_at
string

Read-only. An ISO 8601 timestamp of when the order item was created.

Example:
2019-03-15T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 timestamp of when the order item was last updated.

Example:
2019-03-15T00:09:15.000Z
order_id
string

The ID of the order the item belongs to.

Example:
bo_bxdmjbwxid
product_id
string

The ID of the product the retailer bought.

Example:
p_fccaefnahr
variant_id
string

The ID of the variant the retailer bought.

Example:
po_3745tjzrpc
quantity
integer

The number of physical items the retailer purchased.

Example:
1
sku
string

The SKU of the variant when the order was created. This may not match the current SKU of the variant.

Example:
goldenretriever
price_cents
integer
deprecated

The wholesale price of the product at the time it was purchased, in USD cents. Deprecated - use price instead.

product_name
string

The name of the product when it was purchased.

Example:
Golden Dog
variant_name
string

The name of the variant when it was purchased.

Example:
retriever
includes_tester
boolean

A boolean indicating whether or not a tester for the variant was purchased.

Example:
false
tester_price_cents
integer
deprecated

If includes_tester is true, the price of the tester in USD cents. Deprecated - use testerPrice instead.

customizations
array[object]

A list of customizations applied to this order item.

price
object

The wholesale price of the item at the time it was purchased.

tester_price
object

If includes_tester is true, the price of the tester.

discounts
array[object]

A list of any product-specific promotions that were applied to this item. Does not include shop-wide promotions, which can be found under the order's brand_discounts field.

state
string

The current state of the order item.

Allowed values:
CANCELED
PROCESSING
PRE_TRANSIT
IN_TRANSIT
DELIVERED
RETURNED
BACKORDERED
DAMAGED_OR_MISSING
PENDING_RETAILER_CONFIRMATION
shipments
array[object]

A list of shipments associated with the order.

id
string

Read-only. A unique identifier of the shipment, beginning with "s_".

Example:
s_bq425ju5vh
created_at
string

Read-only. An ISO 8601 timestamp of when the shipment was created.

Example:
2019-03-15T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 timestamp of when the shipment was last updated.

Example:
2019-03-15T00:09:15.000Z
order_id
string

The ID of the order the shipment is attached to.

Example:
bo_bxdmjbwxid
maker_cost_cents
integer
deprecated

The cost the brand paid to ship the order, in USD cents. Deprecated - use makerCost instead.

carrier
string

The carrier the brand used to ship the order. Currently, the accepted values are CANADA_POST, DHL_ECOMMERCE, DHL_EXPRESS, FEDEX, PUROLATOR, UPS, USPS, POSTNL, CANPAR, INTERLINK_EXPRESS, GSO, ROYAL_MAIL, DPD, DPDUK, PARCELFORCE, AUSTRALIA_POST, EVRI, and LA_POSTE. These values are case insensitive. If another string is entered for this field, Faire will do its best to produce tracking information for that carrier, but may not succeed.

Example:
fedex
tracking_code
string

The tracking code for the shipment, format varies based on the carrier.

Example:
94029300101029282
maker_cost
object

The cost the brand paid to ship the order.

shipping_type
string

The type of shipping selected for this shipment (either SHIP_ON_YOUR_OWN or SHIP_WITH_FAIRE).

Allowed values:
SHIP_ON_YOUR_OWN
SHIP_WITH_FAIRE
shipping_label_url
string

A URL to the shipping label for this shipment, if available. This field is read-only.

Example:
https://cdn.faire.com/shipping-labels/label_abc123.pdf
address
object

The address the order should be shipped to.

id
string

Read-only. The unique identifier of the address, beginning with "a_".

Example:
a_abc123def
name
string

The name of the individual (recipient) to contact at the address.

Example:
John Smith
address1
string

The first line of street address information.

Example:
41 King Street West
address2
string

Optional. The second line of street address information.

Example:
3rd Floor
postal_code
string

The ZIP/postal code.

Example:
N2G 1A1
city
string

The city name.

Example:
Kitchener
state
string

The full name of the state or province.

Example:
Ontario
state_code
string

The ISO 3166 two-letter code for the state or province.

Example:
ON
phone_number
string

The phone number used to contact the recipient.

Example:
555-123-4567
country
string

The full name of the country.

Example:
Canada
country_code
string

The ISO alpha-3 country code.

Example:
CAN
company_name
string

The name of the company at this address.

Example:
Faire Wholesale, Inc
address_type
string

Best effort attempt to map the address to am address type. This occurs asynchronously to it might not be populated.

Allowed values:
RESIDENTIAL
COMMERCIAL
MIXED
ship_after
string

An ISO 8601 timestamp of the earliest the order should ship.

Example:
2019-03-15T00:09:15.000Z
payout_costs
object

The payout costs associated with the order. NOTE: This may change until the order has been paid out (payment_initiated_at is set), for example if items are removed from the order.

payout_fee_cents
integer
deprecated

The amount charged to the brand to pay out the order, (e.g. for next-day ACH transfers), in USD cents. Deprecated - use payoutFee instead.

payout_fee_bps
integer

The payout fee basis points used to calculate the payout fee (e.g. 300 is 3%).

Example:
0
payout_flat_fee
object

The payout flat fee amount charged in addition to payout_fee_bps.

commission_cents
integer
deprecated

The amount of commission charged to the brand for the order, in USD cents. Deprecated - use commission instead.

commission_bps
integer

The commission basis points used to calculate the commission (e.g. 1500 is 15%).

Example:
2500
commission_flat_fee
object

The commission flat fee amount (showing up as "New customer fee" in Faire brand portal) charged in addition to commission_bps.

payout_fee
object

The amount charged to the brand to pay out the order (e.g. for next-day ACH transfers). (item subtotal x payout_fee_bps + payout_flat_fee)

commission
object

The amount of commission charged to the brand for the order. (item subtotal x commission_bps + commission_flat_fee)

total_payout
object

The amount paid out to the brand after all fees and deductions.

payout_protection_fee
object

The amount charged to the brand for the Faire shipping protection program, if the brand is a participant.

damaged_and_missing_items
object

The amount deducted for any items reported missing or damaged in shipping.

net_tax
object

The amount of tax charged to the retailer and included in the payout.

shipping_subsidy
object

The amount charged to the brand for the free shipping partnership program, if the brand is a participant.

taxes
array[object]

A list of the individual taxes that make up net_tax.

subtotal_after_brand_discounts
object

The order subtotal after applying shop-wide discounts and product-specific discounts relevant to this order.

total_brand_discounts
object

The sum of all the shop-wide and product-specific discounts applied to this order.

payment_initiated_at
string

An ISO 8601 timestamp of when the brand was paid for this order. Null/absent if the order has not been paid yet.

Example:
2019-03-16T00:10:34.000Z
original_order_id
string

If this order has a parent, for example due to a backorder, this contains the ID of the original order. Null/absent otherwise.

Example:
bo_bg5ude6pmd
retailer_id
string

A unique identifier that represents the retailer who placed the order. See retailers for more information.

Example:
r_c9385ldj
source
string

How this order was initiated (may be MARKETPLACE, FAIRE_DIRECT, TRADESHOW, etc).

Example:
MARKETPLACE
expected_ship_date
string

If specified, an ISO 8601 timestamp of when the order is expected to be shipped.

customer
object
first_name
string

The first name of the customer.

Example:
John
last_name
string

The last name of the customer.

Example:
Smith
brand_discounts
array[object]

A list of any shop-wide promotions that were applied to this order. Does not include product-specific discounts, which can be found under the discounts field of the relevant order item.

id
string

A unique identifier for the discount, beginning with "bpc_".

Example:
bpc_k3w2kb97tp
code
string

The name of the promotion as it appears to retailers at checkout.

Example:
SUMMER10
discount_type
string

This is PERCENTAGE, FLAT_AMOUNT, or NONE depending on how the discount is calculated. A discount of type NONE means that this discount affected something other than the purchase price, such as free shipping or duties.

Allowed values:
FLAT_AMOUNT
PERCENTAGE
NONE
discount_amount_cents
integer
deprecated

Deprecated. Depending on discountType either discountAmountCents or discountPercentage is populated.

discount_percentage
number

The discount amount as a percent of the total. This value is present only when the discount_type is PERCENTAGE.

Example:
10
includes_free_shipping
boolean

Whether this promotion is for free shipping.

Example:
false
discount_amount
object

The amount of money for the discount. This value is present only when the discount_type is FLAT_AMOUNT.

requested_ship_date
string

An ISO 8601 timestamp of when the retailer requested the order to be shipped.

processing_at
string

An ISO 8601 timestamp of when the order moved to PROCESSING state.

is_free_shipping
boolean

True if the order has free shipping of any kind, false otherwise.

Example:
true
free_shipping_reason
string

The reason the order has free shipping, if any.

Allowed values:
INSIDER_FREE_SHIPPING
FAIRE_DIRECT
BRAND_DISCOUNT
FIRST_ORDER
PROMO_CODE
FREE_SHIPPING_THRESHOLD
faire_covered_shipping_cost
object

The amount of the total shipping cost Faire is paying for, if applicable.

amount_minor
integer

The amount of money in the smallest unit of the applicable currency. For example, US dollars is in cents.

Example:
4999
currency
string

The type of currency involved in the current payment in ISO 4217 format. For example, US dollars is USD.

Example:
USD
estimated_payout_at
string

An ISO 8601 timestamp of when Faire expects to pay the brand for the order. Note that this is not a guarantee of when the order will be paid out.

Example:
2019-03-16T00:00:00.000Z
is_fulfilled_by_faire
boolean

True if the order is fulfilled by Faire, false otherwise.

Example:
false
purchase_order_number
string

Purchase order number entered by retailer (free-text, not validated by Faire).

Example:
12345
notes
string

Brand-facing notes for the order. This field is free-text and may contain special requests or instructions from the retailer.

Example:
Please include a handwritten thank-you note
has_pending_retailer_cancellation_request
boolean

Indicates whether there is a pending cancellation request from the retailer for this order. This is true if the retailer has requested cancellation, the request has not been rejected, and the order is not already canceled.

sales_rep_name
string

The name of the brand sales rep attributed to this order

Auth
X-FAIRE-OAUTH-ACCESS-TOKEN
:
X-FAIRE-APP-CREDENTIALS
:
Parameters
order_id*
:
Body
1
{
2
  "note": "string",
3
  "reason": "REQUESTED_BY_RETAILER"
4
}
Send API Request
Request Sample: Shell / cURL
curl --request PUT \
  --url https://www.faire.com/external-api/v2/orders/{order_id}/cancel \
  --header 'Accept: application/json' \
  --header 'Content-Type: application/json' \
  --header 'X-FAIRE-APP-CREDENTIALS: 123' \
  --header 'X-FAIRE-OAUTH-ACCESS-TOKEN: 123' \
  --data '{
  "note": "string",
  "reason": "REQUESTED_BY_RETAILER"
}'
Response Example
1
{
2
  "id": "bo_bxdmjbwxid",
3
  "display_id": "BXDMJBWXID",
4
  "created_at": "2019-03-15T00:09:15.000Z",
5
  "updated_at": "2019-03-15T00:10:00.000Z",
6
  "state": "NEW",
7
  "items": [
8
    {
9
      "id": "oi_bq425ju5vh",
10
      "created_at": "2019-03-15T00:09:15.000Z",
11
      "updated_at": "2019-03-15T00:09:15.000Z",
12
      "order_id": "bo_bxdmjbwxid",
13
      "product_id": "p_fccaefnahr",
14
      "variant_id": "po_3745tjzrpc",
15
      "quantity": 1,
16
      "sku": "goldenretriever",
17
      "price_cents": 0,
18
      "product_name": "Golden Dog",
19
      "variant_name": "retriever",
20
      "includes_tester": false,
21
      "tester_price_cents": 0,
22
      "customizations": [
23
        {
24
          "token": "custom_abc123",
25
          "type": "text",
26
          "value": "Happy Birthday!"
27
        }
28
      ],
29
      "price": {
30
        "amount_minor": 4999,
31
        "currency": "USD"
32
      },
33
      "tester_price": {
34
        "amount_minor": 4999,
35
        "currency": "USD"
36
      },
37
      "discounts": [
38
        {
39
          "id": "bpc_k3w2kb97tp",
40
          "code": "SUMMER10",
41
          "discount_type": "FLAT_AMOUNT",
42
          "discount_amount_cents": 0,
43
          "discount_percentage": 10,
44
          "includes_free_shipping": false,
45
          "discount_amount": {
46
            "amount_minor": 4999,
47
            "currency": "USD"
48
          }
49
        }
50
      ],
51
      "state": "CANCELED"
52
    }
53
  ],
54
  "shipments": [
55
    {
56
      "id": "s_bq425ju5vh",
57
      "created_at": "2019-03-15T00:09:15.000Z",
58
      "updated_at": "2019-03-15T00:09:15.000Z",
59
      "order_id": "bo_bxdmjbwxid",
60
      "maker_cost_cents": 0,
61
      "carrier": "fedex",
62
      "tracking_code": "94029300101029282",
63
      "maker_cost": {
64
        "amount_minor": 4999,
65
        "currency": "USD"
66
      },
67
      "shipping_type": "SHIP_ON_YOUR_OWN",
68
      "shipping_label_url": "https://cdn.faire.com/shipping-labels/label_abc123.pdf"
69
    }
70
  ],
71
  "address": {
72
    "id": "a_abc123def",
73
    "name": "John Smith",
74
    "address1": "41 King Street West",
75
    "address2": "3rd Floor",
76
    "postal_code": "N2G 1A1",
77
    "city": "Kitchener",
78
    "state": "Ontario",
79
    "state_code": "ON",
80
    "phone_number": "555-123-4567",
81
    "country": "Canada",
82
    "country_code": "CAN",
83
    "company_name": "Faire Wholesale, Inc",
84
    "address_type": "RESIDENTIAL"
85
  },
86
  "ship_after": "2019-03-15T00:09:15.000Z",
87
  "payout_costs": {
88
    "payout_fee_cents": 0,
89
    "payout_fee_bps": 0,
90
    "payout_flat_fee": {
91
      "amount_minor": 4999,
92
      "currency": "USD"
93
    },
94
    "commission_cents": 0,
95
    "commission_bps": 2500,
96
    "commission_flat_fee": {
97
      "amount_minor": 4999,
98
      "currency": "USD"
99
    },
100
    "payout_fee": {
101
      "amount_minor": 4999,
102
      "currency": "USD"
103
    },
104
    "commission": {
105
      "amount_minor": 4999,
106
      "currency": "USD"
107
    },
108
    "total_payout": {
109
      "amount_minor": 4999,
110
      "currency": "USD"
111
    },
112
    "payout_protection_fee": {
113
      "amount_minor": 4999,
114
      "currency": "USD"
115
    },
116
    "damaged_and_missing_items": {
117
      "amount_minor": 4999,
118
      "currency": "USD"
119
    },
120
    "net_tax": {
121
      "amount_minor": 4999,
122
      "currency": "USD"
123
    },
124
    "shipping_subsidy": {
125
      "amount_minor": 4999,
126
      "currency": "USD"
127
    },
128
    "taxes": [
129
      {
130
        "value": {
131
          "amount_minor": 4999,
132
          "currency": "USD"
133
        },
134
        "taxable_item_type": "ORDER_ITEM",
135
        "tax_type": "CANADIAN_TAX",
136
        "effect": "INCREASES_PAYOUT"
137
      }
138
    ],
139
    "subtotal_after_brand_discounts": {
140
      "amount_minor": 4999,
141
      "currency": "USD"
142
    },
143
    "total_brand_discounts": {
144
      "amount_minor": 4999,
145
      "currency": "USD"
146
    }
147
  },
148
  "payment_initiated_at": "2019-03-16T00:10:34.000Z",
149
  "original_order_id": "bo_bg5ude6pmd",
150
  "retailer_id": "r_c9385ldj",
151
  "source": "MARKETPLACE",
152
  "expected_ship_date": "string",
153
  "customer": {
154
    "first_name": "John",
155
    "last_name": "Smith"
156
  },
157
  "brand_discounts": [
158
    {
159
      "id": "bpc_k3w2kb97tp",
160
      "code": "SUMMER10",
161
      "discount_type": "FLAT_AMOUNT",
162
      "discount_amount_cents": 0,
163
      "discount_percentage": 10,
164
      "includes_free_shipping": false,
165
      "discount_amount": {
166
        "amount_minor": 4999,
167
        "currency": "USD"
168
      }
169
    }
170
  ],
171
  "requested_ship_date": "string",
172
  "processing_at": "string",
173
  "is_free_shipping": true,
174
  "free_shipping_reason": "INSIDER_FREE_SHIPPING",
175
  "faire_covered_shipping_cost": {
176
    "amount_minor": 4999,
177
    "currency": "USD"
178
  },
179
  "estimated_payout_at": "2019-03-16T00:00:00.000Z",
180
  "is_fulfilled_by_faire": false,
181
  "purchase_order_number": "12345",
182
  "notes": "Please include a handwritten thank-you note",
183
  "has_pending_retailer_cancellation_request": true,
184
  "sales_rep_name": "string"
185
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/paths/orders-order_id--packing-slip-pdf/get

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
Product Variants
Products
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
GET /orders/{order_id}/packing-slip-pdf
GET
https://www.faire.com/external-api/v2/orders/{order_id}/packing-slip-pdf

This endpoint retrieves a PDF packing slip for a specific brand order.

Request
Security: API Key (OAuth) & API Key (AppCredentials)
Path Parameters
order_id
string
required
Query Parameters
timezone
string
Responses
200
400
401
404
405
429
500
503

Successful response

Auth
X-FAIRE-OAUTH-ACCESS-TOKEN
:
X-FAIRE-APP-CREDENTIALS
:
Parameters
order_id*
:
timezone
:
Send API Request
Request Sample: Shell / cURL
curl --request GET \
  --url https://www.faire.com/external-api/v2/orders/{order_id}/packing-slip-pdf \
  --header 'X-FAIRE-APP-CREDENTIALS: 123' \
  --header 'X-FAIRE-OAUTH-ACCESS-TOKEN: 123'
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/paths/orders/get

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
Product Variants
Products
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
GET /orders
GET
https://www.faire.com/external-api/v2/orders

This endpoint retrieves a list of orders, ordered ascending by updated_at.

Request
Security: API Key (OAuth) & API Key (AppCredentials)
Query Parameters
created_at_min
string
cursor
string
excluded_states
string
limit
integer
original_order_id
string
page
integer
ship_after_max
string
sort_by
string
updated_at_min
string
Responses
200
400
401
404
405
429
500
503

Successful response

Body
application/json
application/json
responses
/
200

Response containing a list of orders for the brand, ordered ascending by updated_at by default.

orders
array[object]

A list of orders.

id
string

Read-only. A unique identifier of the order, beginning with "bo_". NOTE: When shown on the Faire website, the "bo_" will be stripped and the order ID will be upper-case. e.g. "bo_bxdmjbwxid" appears as "#BXDMJBWXID" (See display_id).

Example:
bo_bxdmjbwxid
display_id
string

Read-only. The order identifier as displayed on the Faire website, emails, etc.

Example:
BXDMJBWXID
created_at
string

Read-only. An ISO 8601 timestamp of when the order was created.

Example:
2019-03-15T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 timestamp of when the order was last updated.

Example:
2019-03-15T00:10:00.000Z
state
string

The current state of the order.

Allowed values:
NEW
PROCESSING
PRE_TRANSIT
IN_TRANSIT
DELIVERED
CANCELED
BACKORDERED
PENDING_RETAILER_CONFIRMATION
items
array[object]

A list of order items associated with the order.

shipments
array[object]

A list of shipments associated with the order.

address
object

The address the order should be shipped to.

ship_after
string

An ISO 8601 timestamp of the earliest the order should ship.

Example:
2019-03-15T00:09:15.000Z
payout_costs
object

The payout costs associated with the order. NOTE: This may change until the order has been paid out (payment_initiated_at is set), for example if items are removed from the order.

payment_initiated_at
string

An ISO 8601 timestamp of when the brand was paid for this order. Null/absent if the order has not been paid yet.

Example:
2019-03-16T00:10:34.000Z
original_order_id
string

If this order has a parent, for example due to a backorder, this contains the ID of the original order. Null/absent otherwise.

Example:
bo_bg5ude6pmd
retailer_id
string

A unique identifier that represents the retailer who placed the order. See retailers for more information.

Example:
r_c9385ldj
source
string

How this order was initiated (may be MARKETPLACE, FAIRE_DIRECT, TRADESHOW, etc).

Example:
MARKETPLACE
expected_ship_date
string

If specified, an ISO 8601 timestamp of when the order is expected to be shipped.

customer
object
brand_discounts
array[object]

A list of any shop-wide promotions that were applied to this order. Does not include product-specific discounts, which can be found under the discounts field of the relevant order item.

requested_ship_date
string

An ISO 8601 timestamp of when the retailer requested the order to be shipped.

processing_at
string

An ISO 8601 timestamp of when the order moved to PROCESSING state.

is_free_shipping
boolean

True if the order has free shipping of any kind, false otherwise.

Example:
true
free_shipping_reason
string

The reason the order has free shipping, if any.

Allowed values:
INSIDER_FREE_SHIPPING
FAIRE_DIRECT
BRAND_DISCOUNT
FIRST_ORDER
PROMO_CODE
FREE_SHIPPING_THRESHOLD
faire_covered_shipping_cost
object

The amount of the total shipping cost Faire is paying for, if applicable.

estimated_payout_at
string

An ISO 8601 timestamp of when Faire expects to pay the brand for the order. Note that this is not a guarantee of when the order will be paid out.

Example:
2019-03-16T00:00:00.000Z
is_fulfilled_by_faire
boolean

True if the order is fulfilled by Faire, false otherwise.

Example:
false
purchase_order_number
string

Purchase order number entered by retailer (free-text, not validated by Faire).

Example:
12345
notes
string

Brand-facing notes for the order. This field is free-text and may contain special requests or instructions from the retailer.

Example:
Please include a handwritten thank-you note
has_pending_retailer_cancellation_request
boolean

Indicates whether there is a pending cancellation request from the retailer for this order. This is true if the retailer has requested cancellation, the request has not been rejected, and the order is not already canceled.

sales_rep_name
string

The name of the brand sales rep attributed to this order

page
integer

The current page number.

limit
integer

The maximum number of orders per page.

updated_at_min
string

The minimum updated_at timestamp used to filter orders.

sort_by
string

The field used to sort the orders.

Allowed values:
UPDATED_AT
CREATED_AT
cursor
string

A cursor for pagination. Use this value in subsequent requests to get the next page of results.

Auth
X-FAIRE-OAUTH-ACCESS-TOKEN
:
X-FAIRE-APP-CREDENTIALS
:
Parameters
created_at_min
:
cursor
:
excluded_states
:
limit
:
original_order_id
:
page
:
ship_after_max
:
sort_by
:
updated_at_min
:
Send API Request
Request Sample: Shell / cURL
curl --request GET \
  --url https://www.faire.com/external-api/v2/orders \
  --header 'Accept: application/json' \
  --header 'X-FAIRE-APP-CREDENTIALS: 123' \
  --header 'X-FAIRE-OAUTH-ACCESS-TOKEN: 123'
Response Example
1
{
2
  "orders": [
3
    {
4
      "id": "bo_bxdmjbwxid",
5
      "display_id": "BXDMJBWXID",
6
      "created_at": "2019-03-15T00:09:15.000Z",
7
      "updated_at": "2019-03-15T00:10:00.000Z",
8
      "state": "NEW",
9
      "items": [
10
        {
11
          "id": "oi_bq425ju5vh",
12
          "created_at": "2019-03-15T00:09:15.000Z",
13
          "updated_at": "2019-03-15T00:09:15.000Z",
14
          "order_id": "bo_bxdmjbwxid",
15
          "product_id": "p_fccaefnahr",
16
          "variant_id": "po_3745tjzrpc",
17
          "quantity": 1,
18
          "sku": "goldenretriever",
19
          "price_cents": 0,
20
          "product_name": "Golden Dog",
21
          "variant_name": "retriever",
22
          "includes_tester": false,
23
          "tester_price_cents": 0,
24
          "customizations": [
25
            {
26
              "token": "custom_abc123",
27
              "type": "text",
28
              "value": "Happy Birthday!"
29
            }
30
          ],
31
          "price": {
32
            "amount_minor": 4999,
33
            "currency": "USD"
34
          },
35
          "tester_price": {
36
            "amount_minor": 4999,
37
            "currency": "USD"
38
          },
39
          "discounts": [
40
            {
41
              "id": "bpc_k3w2kb97tp",
42
              "code": "SUMMER10",
43
              "discount_type": "FLAT_AMOUNT",
44
              "discount_amount_cents": 0,
45
              "discount_percentage": 10,
46
              "includes_free_shipping": false,
47
              "discount_amount": {
48
                "amount_minor": 4999,
49
                "currency": "USD"
50
              }
51
            }
52
          ],
53
          "state": "CANCELED"
54
        }
55
      ],
56
      "shipments": [
57
        {
58
          "id": "s_bq425ju5vh",
59
          "created_at": "2019-03-15T00:09:15.000Z",
60
          "updated_at": "2019-03-15T00:09:15.000Z",
61
          "order_id": "bo_bxdmjbwxid",
62
          "maker_cost_cents": 0,
63
          "carrier": "fedex",
64
          "tracking_code": "94029300101029282",
65
          "maker_cost": {
66
            "amount_minor": 4999,
67
            "currency": "USD"
68
          },
69
          "shipping_type": "SHIP_ON_YOUR_OWN",
70
          "shipping_label_url": "https://cdn.faire.com/shipping-labels/label_abc123.pdf"
71
        }
72
      ],
73
      "address": {
74
        "id": "a_abc123def",
75
        "name": "John Smith",
76
        "address1": "41 King Street West",
77
        "address2": "3rd Floor",
78
        "postal_code": "N2G 1A1",
79
        "city": "Kitchener",
80
        "state": "Ontario",
81
        "state_code": "ON",
82
        "phone_number": "555-123-4567",
83
        "country": "Canada",
84
        "country_code": "CAN",
85
        "company_name": "Faire Wholesale, Inc",
86
        "address_type": "RESIDENTIAL"
87
      },
88
      "ship_after": "2019-03-15T00:09:15.000Z",
89
      "payout_costs": {
90
        "payout_fee_cents": 0,
91
        "payout_fee_bps": 0,
92
        "payout_flat_fee": {
93
          "amount_minor": 4999,
94
          "currency": "USD"
95
        },
96
        "commission_cents": 0,
97
        "commission_bps": 2500,
98
        "commission_flat_fee": {
99
          "amount_minor": 4999,
100
          "currency": "USD"
101
        },
102
        "payout_fee": {
103
          "amount_minor": 4999,
104
          "currency": "USD"
105
        },
106
        "commission": {
107
          "amount_minor": 4999,
108
          "currency": "USD"
109
        },
110
        "total_payout": {
111
          "amount_minor": 4999,
112
          "currency": "USD"
113
        },
114
        "payout_protection_fee": {
115
          "amount_minor": 4999,
116
          "currency": "USD"
117
        },
118
        "damaged_and_missing_items": {
119
          "amount_minor": 4999,
120
          "currency": "USD"
121
        },
122
        "net_tax": {
123
          "amount_minor": 4999,
124
          "currency": "USD"
125
        },
126
        "shipping_subsidy": {
127
          "amount_minor": 4999,
128
          "currency": "USD"
129
        },
130
        "taxes": [
131
          {
132
            "value": {
133
              "amount_minor": 4999,
134
              "currency": "USD"
135
            },
136
            "taxable_item_type": "ORDER_ITEM",
137
            "tax_type": "CANADIAN_TAX",
138
            "effect": "INCREASES_PAYOUT"
139
          }
140
        ],
141
        "subtotal_after_brand_discounts": {
142
          "amount_minor": 4999,
143
          "currency": "USD"
144
        },
145
        "total_brand_discounts": {
146
          "amount_minor": 4999,
147
          "currency": "USD"
148
        }
149
      },
150
      "payment_initiated_at": "2019-03-16T00:10:34.000Z",
151
      "original_order_id": "bo_bg5ude6pmd",
152
      "retailer_id": "r_c9385ldj",
153
      "source": "MARKETPLACE",
154
      "expected_ship_date": "string",
155
      "customer": {
156
        "first_name": "John",
157
        "last_name": "Smith"
158
      },
159
      "brand_discounts": [
160
        {
161
          "id": "bpc_k3w2kb97tp",
162
          "code": "SUMMER10",
163
          "discount_type": "FLAT_AMOUNT",
164
          "discount_amount_cents": 0,
165
          "discount_percentage": 10,
166
          "includes_free_shipping": false,
167
          "discount_amount": {
168
            "amount_minor": 4999,
169
            "currency": "USD"
170
          }
171
        }
172
      ],
173
      "requested_ship_date": "string",
174
      "processing_at": "string",
175
      "is_free_shipping": true,
176
      "free_shipping_reason": "INSIDER_FREE_SHIPPING",
177
      "faire_covered_shipping_cost": {
178
        "amount_minor": 4999,
179
        "currency": "USD"
180
      },
181
      "estimated_payout_at": "2019-03-16T00:00:00.000Z",
182
      "is_fulfilled_by_faire": false,
183
      "purchase_order_number": "12345",
184
      "notes": "Please include a handwritten thank-you note",
185
      "has_pending_retailer_cancellation_request": true,
186
      "sales_rep_name": "string"
187
    }
188
  ],
189
  "page": 0,
190
  "limit": 0,
191
  "updated_at_min": "string",
192
  "sort_by": "UPDATED_AT",
193
  "cursor": "string"
194
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/paths/product-prices-by-product-variant-ids/patch

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
Product Variants
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
PATCH /product-prices/by-product-variant-ids
PATCH
https://www.faire.com/external-api/v2/product-prices/by-product-variant-ids

This endpoint updates prices for multiple product variants in a single request, identified by their product variant IDs.

Request
Security: API Key (OAuth) & API Key (AppCredentials)
Body
application/json
application/json

Request to update product prices in batch by product variant IDs.

prices
array[object]

List of product variant price updates by product variant ID.

product_variant_id
string

The product variant ID to update.

prices
array[object]

The new prices for this variant.

Responses
200
400
401
404
405
429
500
503

Successful response

Body
application/json
application/json
responses
/
200

Response from updating product prices in batch.

results
dictionary[string, object]
prices
array[object]

The updated prices for this identifier.

Auth
X-FAIRE-OAUTH-ACCESS-TOKEN
:
X-FAIRE-APP-CREDENTIALS
:
Body
1
{
2
  "prices": [
3
    {
4
      "product_variant_id": "string",
5
      "prices": [
6
        {
7
          "geo_constraint": {
8
            "country": "USA",
9
            "country_group": "EUROPEAN_UNION"
10
          },
11
          "wholesale_price": {
12
            "amount_minor": 4999,
13
            "currency": "USD"
14
          },
15
          "retail_price": {
16
            "amount_minor": 4999,
17
            "currency": "USD"
18
          }
19
        }
20
      ]
21
    }
22
  ]
23
}
Send API Request
Request Sample: Shell / cURL
curl --request PATCH \
  --url https://www.faire.com/external-api/v2/product-prices/by-product-variant-ids \
  --header 'Accept: application/json' \
  --header 'Content-Type: application/json' \
  --header 'X-FAIRE-APP-CREDENTIALS: 123' \
  --header 'X-FAIRE-OAUTH-ACCESS-TOKEN: 123' \
  --data '{
  "prices": [
    {
      "product_variant_id": "string",
      "prices": [
        {
          "geo_constraint": {
            "country": "USA",
            "country_group": "EUROPEAN_UNION"
          },
          "wholesale_price": {
            "amount_minor": 4999,
            "currency": "USD"
          },
          "retail_price": {
            "amount_minor": 4999,
            "currency": "USD"
          }
        }
      ]
    }
  ]
}'
Response Example
1
{
2
  "results": {
3
    "property1": {
4
      "prices": [
5
        {
6
          "geo_constraint": {
7
            "country": "USA",
8
            "country_group": "EUROPEAN_UNION"
9
          },
10
          "wholesale_price": {
11
            "amount_minor": 4999,
12
            "currency": "USD"
13
          },
14
          "retail_price": {
15
            "amount_minor": 4999,
16
            "currency": "USD"
17
          }
18
        }
19
      ]
20
    },
21
    "property2": {
22
      "prices": [
23
        {
24
          "geo_constraint": {
25
            "country": "USA",
26
            "country_group": "EUROPEAN_UNION"
27
          },
28
          "wholesale_price": {
29
            "amount_minor": 4999,
30
            "currency": "USD"
31
          },
32
          "retail_price": {
33
            "amount_minor": 4999,
34
            "currency": "USD"
35
          }
36
        }
37
      ]
38
    }
39
  }
40
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/paths/product-prices-by-skus/patch

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
Product Variants
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
PATCH /product-prices/by-skus
PATCH
https://www.faire.com/external-api/v2/product-prices/by-skus

This endpoint updates prices for multiple product variants in a single request, identified by their SKUs.

Request
Security: API Key (OAuth) & API Key (AppCredentials)
Body
application/json
application/json

Request to update product prices in batch by SKUs.

prices
array[object]

List of product variant price updates by SKU.

sku
string

The SKU to update.

prices
array[object]

The new prices for this variant.

Responses
200
400
401
404
405
429
500
503

Successful response

Body
application/json
application/json
responses
/
200

Response from updating product prices in batch.

results
dictionary[string, object]
prices
array[object]

The updated prices for this identifier.

Auth
X-FAIRE-OAUTH-ACCESS-TOKEN
:
X-FAIRE-APP-CREDENTIALS
:
Body
1
{
2
  "prices": [
3
    {
4
      "sku": "string",
5
      "prices": [
6
        {
7
          "geo_constraint": {
8
            "country": "USA",
9
            "country_group": "EUROPEAN_UNION"
10
          },
11
          "wholesale_price": {
12
            "amount_minor": 4999,
13
            "currency": "USD"
14
          },
15
          "retail_price": {
16
            "amount_minor": 4999,
17
            "currency": "USD"
18
          }
19
        }
20
      ]
21
    }
22
  ]
23
}
Send API Request
Request Sample: Shell / cURL
curl --request PATCH \
  --url https://www.faire.com/external-api/v2/product-prices/by-skus \
  --header 'Accept: application/json' \
  --header 'Content-Type: application/json' \
  --header 'X-FAIRE-APP-CREDENTIALS: 123' \
  --header 'X-FAIRE-OAUTH-ACCESS-TOKEN: 123' \
  --data '{
  "prices": [
    {
      "sku": "string",
      "prices": [
        {
          "geo_constraint": {
            "country": "USA",
            "country_group": "EUROPEAN_UNION"
          },
          "wholesale_price": {
            "amount_minor": 4999,
            "currency": "USD"
          },
          "retail_price": {
            "amount_minor": 4999,
            "currency": "USD"
          }
        }
      ]
    }
  ]
}'
Response Example
1
{
2
  "results": {
3
    "property1": {
4
      "prices": [
5
        {
6
          "geo_constraint": {
7
            "country": "USA",
8
            "country_group": "EUROPEAN_UNION"
9
          },
10
          "wholesale_price": {
11
            "amount_minor": 4999,
12
            "currency": "USD"
13
          },
14
          "retail_price": {
15
            "amount_minor": 4999,
16
            "currency": "USD"
17
          }
18
        }
19
      ]
20
    },
21
    "property2": {
22
      "prices": [
23
        {
24
          "geo_constraint": {
25
            "country": "USA",
26
            "country_group": "EUROPEAN_UNION"
27
          },
28
          "wholesale_price": {
29
            "amount_minor": 4999,
30
            "currency": "USD"
31
          },
32
          "retail_price": {
33
            "amount_minor": 4999,
34
            "currency": "USD"
35
          }
36
        }
37
      ]
38
    }
39
  }
40
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/paths/products-product_id--images--image_id/delete

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
Product Variants
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
DELETE /products/{product_id}/images/{image_id}
DELETE
https://www.faire.com/external-api/v2/products/{product_id}/images/{image_id}

Removes an image from a product. To remove images from a variant, see Delete image from variant. Published products need at least one image. If you try to remove the last image, this endpoint returns 400 Bad Request.

Request
Security: API Key (OAuth) & API Key (AppCredentials)
Path Parameters
image_id
string
required
product_id
string
required
Responses
200
400
401
404
405
429
500
503

Successful response

Auth
X-FAIRE-OAUTH-ACCESS-TOKEN
:
X-FAIRE-APP-CREDENTIALS
:
Parameters
image_id*
:
product_id*
:
Send API Request
Request Sample: Shell / cURL
curl --request DELETE \
  --url https://www.faire.com/external-api/v2/products/{product_id}/images/{image_id} \
  --header 'X-FAIRE-APP-CREDENTIALS: 123' \
  --header 'X-FAIRE-OAUTH-ACCESS-TOKEN: 123'
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/paths/products-product_id--prepacks-batch/post

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
POST /products/{product_id}/prepacks/batch
POST
https://www.faire.com/external-api/v2/products/{product_id}/prepacks/batch

Creates multiple prepacks for a product in a single request.

Request
Security: API Key (OAuth) & API Key (AppCredentials)
Path Parameters
product_id
string
required
Body
application/json
application/json

Request to create one or more prepacks (multi-item packages sold as a unit).

prepacks
array[object]

A list of prepacks to create.

id
string

Read-only. A unique identifier of the prepack, beginning with "pc_".

Example:
pc_xyz789
idempotence_token
string

The identifier used for idempotence when this prepack was created.

Example:
prepack_abc123
created_at
string

Read-only. An ISO 8601 timestamp of when the prepack was created.

Example:
2019-03-14T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 timestamp of when the prepack was most recently updated.

Example:
2019-03-15T00:09:15.000Z
name
string

The name of the prepack.

Example:
Assorted Sizes Pack
description
string

A description of the prepack. The description is determined by the quantities and sizes of prepack items.

Example:
Pack includes 2 Small, 3 Medium, 2 Large
items
array[object]

A list of prepack items that belong to this prepack.

Responses
200
400
401
404
405
429
500
503

Successful response

Body
application/json
application/json
responses
/
200

Response containing the created prepacks with their assigned IDs.

prepacks
array[object]

The list of created prepacks.

id
string

Read-only. A unique identifier of the prepack, beginning with "pc_".

Example:
pc_xyz789
idempotence_token
string

The identifier used for idempotence when this prepack was created.

Example:
prepack_abc123
created_at
string

Read-only. An ISO 8601 timestamp of when the prepack was created.

Example:
2019-03-14T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 timestamp of when the prepack was most recently updated.

Example:
2019-03-15T00:09:15.000Z
name
string

The name of the prepack.

Example:
Assorted Sizes Pack
description
string

A description of the prepack. The description is determined by the quantities and sizes of prepack items.

Example:
Pack includes 2 Small, 3 Medium, 2 Large
items
array[object]

A list of prepack items that belong to this prepack.

Auth
X-FAIRE-OAUTH-ACCESS-TOKEN
:
X-FAIRE-APP-CREDENTIALS
:
Parameters
product_id*
:
Body
1
{
2
  "prepacks": [
3
    {
4
      "id": "pc_xyz789",
5
      "idempotence_token": "prepack_abc123",
6
      "created_at": "2019-03-14T00:09:15.000Z",
7
      "updated_at": "2019-03-15T00:09:15.000Z",
8
      "name": "Assorted Sizes Pack",
9
      "description": "Pack includes 2 Small, 3 Medium, 2 Large",
10
      "items": [
11
        {
12
          "id": "pci_abc456",
13
          "created_at": "2019-03-14T00:09:15.000Z",
14
          "updated_at": "2019-03-15T00:09:15.000Z",
15
          "variant_id": "po_3745tjzrpc",
16
          "quantity": 3
17
        }
18
      ]
19
    }
20
  ]
21
}
Send API Request
Request Sample: Shell / cURL
curl --request POST \
  --url https://www.faire.com/external-api/v2/products/{product_id}/prepacks/batch \
  --header 'Accept: application/json' \
  --header 'Content-Type: application/json' \
  --header 'X-FAIRE-APP-CREDENTIALS: 123' \
  --header 'X-FAIRE-OAUTH-ACCESS-TOKEN: 123' \
  --data '{
  "prepacks": [
    {
      "id": "pc_xyz789",
      "idempotence_token": "prepack_abc123",
      "created_at": "2019-03-14T00:09:15.000Z",
      "updated_at": "2019-03-15T00:09:15.000Z",
      "name": "Assorted Sizes Pack",
      "description": "Pack includes 2 Small, 3 Medium, 2 Large",
      "items": [
        {
          "id": "pci_abc456",
          "created_at": "2019-03-14T00:09:15.000Z",
          "updated_at": "2019-03-15T00:09:15.000Z",
          "variant_id": "po_3745tjzrpc",
          "quantity": 3
        }
      ]
    }
  ]
}'
Response Example
1
{
2
  "prepacks": [
3
    {
4
      "id": "pc_xyz789",
5
      "idempotence_token": "prepack_abc123",
6
      "created_at": "2019-03-14T00:09:15.000Z",
7
      "updated_at": "2019-03-15T00:09:15.000Z",
8
      "name": "Assorted Sizes Pack",
9
      "description": "Pack includes 2 Small, 3 Medium, 2 Large",
10
      "items": [
11
        {
12
          "id": "pci_abc456",
13
          "created_at": "2019-03-14T00:09:15.000Z",
14
          "updated_at": "2019-03-15T00:09:15.000Z",
15
          "variant_id": "po_3745tjzrpc",
16
          "quantity": 3
17
        }
18
      ]
19
    }
20
  ]
21
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/paths/products-product_id--variants--variant_id--images--image_id/delete

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
https://www.faire.com/external-api/v2/products/{product_id}/variants/{variant_id}/images/{image_id}

Removes an image from a variant.

Request
Security: API Key (OAuth) & API Key (AppCredentials)
Path Parameters
image_id
string
required
product_id
string
required
variant_id
string
required
Responses
200
400
401
404
405
429
500
503

Successful response

Auth
X-FAIRE-OAUTH-ACCESS-TOKEN
:
X-FAIRE-APP-CREDENTIALS
:
Parameters
image_id*
:
product_id*
:
variant_id*
:
Send API Request
Request Sample: Shell / cURL
curl --request DELETE \
  --url https://www.faire.com/external-api/v2/products/{product_id}/variants/{variant_id}/images/{image_id} \
  --header 'X-FAIRE-APP-CREDENTIALS: 123' \
  --header 'X-FAIRE-OAUTH-ACCESS-TOKEN: 123'
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/paths/products-upload-image/post

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
POST /products/upload-image
POST
https://www.faire.com/external-api/v2/products/upload-image

We recommend uploading images to Faire before attempting to use them for a product or variant. This provides you with immediate feedback on whether the image is valid and accessible.

Request
Security: API Key (OAuth) & API Key (AppCredentials)
Body
application/json
application/json

Request to upload an image by providing a base64-encoded image attachment.

attachment
string

The image file, encoded in Base64.

Responses
200
400
401
404
405
429
500
503

Successful response

Body
application/json
application/json
responses
/
200

Response containing the URL of the uploaded image hosted on Faire's CDN.

url
string

The URL of the uploaded image hosted on Faire's CDN.

Auth
X-FAIRE-OAUTH-ACCESS-TOKEN
:
X-FAIRE-APP-CREDENTIALS
:
Body
1
{
2
  "attachment": "string"
3
}
Send API Request
Request Sample: Shell / cURL
curl --request POST \
  --url https://www.faire.com/external-api/v2/products/upload-image \
  --header 'Accept: application/json' \
  --header 'Content-Type: application/json' \
  --header 'X-FAIRE-APP-CREDENTIALS: 123' \
  --header 'X-FAIRE-OAUTH-ACCESS-TOKEN: 123' \
  --data '{
  "attachment": "string"
}'
Response Example
1
{
2
  "url": "string"
3
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/paths/products/get

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
GET /products
GET
https://www.faire.com/external-api/v2/products

This endpoint retrieves a list of products, ordered ascending by updated_at. By default, it only returns products that are not deleted.

Request
Security: API Key (OAuth) & API Key (AppCredentials)
Query Parameters
cursor
string
include_deleted
boolean
limit
integer
page
integer
sku
string
updated_at_min
string
Responses
200
400
401
404
405
429
500
503

Successful response

Body
application/json
application/json
responses
/
200

Response containing a paginated list of products for the brand.

products
array[object]

A list of products.

id
string

Read-only. The unique identifier of the product, beginning with "p_".

Example:
p_123
created_at
string

Read-only. An ISO 8601 extended timestamp of when the product was created.

Example:
2019-03-14T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 extended timestamp of when the product was last updated.

Example:
2019-03-15T00:09:15.000Z
brand_id
string

Read-only. A unique identifier of the brand that owns the product, beginning with "b_".

Example:
b_abc
name
string

The name of the product.

Example:
Faire's fantastic candle
description
string

A description of the product, at most 65,535 characters.

Example:
Glad you decided to read our description! We have significantly more characters to describe to you just how good our candles smell.
short_description
string

A short description of the product, at most 255 characters.

Example:
Our candles smell fantastic. Want to know how good? Read our description!
sale_state
string

Read-only. The current sellability of the product on Faire.

Allowed values:
FOR_SALE
SALES_PAUSED
lifecycle_state
string

Read-only. The current stage in the lifecycle of a product on Faire.

Allowed values:
DRAFT
PUBLISHED
UNPUBLISHED
DELETED
variants
array[object]

A list of product variants that belong to this product.

idempotence_token
string

TODO (bad docs): The identifier used when this product was created.

Example:
4aytry2ust
unit_multiplier
integer

Also known as case size or case quantity. This is the unit size that this product ships in. The product must be purchased in increments of this number.

Example:
2
minimum_order_quantity
integer

The minimum number of units required to purchase this product. Must be a multiple of the unit_multiplier.

Example:
8
per_style_minimum_order_quantity
integer

The minimum number of units of this product that can be ordered for the same "style". "Style" is defined as the set of variation values excluding the value for the "Size" variation. A product without a "Size" variation cannot use perStyleMinimumOrderQuantity.Show all...

Example:
0
allow_sales_when_out_of_stock
boolean

determines if the state of the options can be SALES_PAUSED for stock reasons

Example:
false
images
array[object]

The list of [images] associated with the product.

variant_option_sets
array[object]

A list of the different available options (attributes) used to compose variants. Products can only have the available option names defined on creation. If you want to redefine a product to have an additional option dimension, you must delete this product and create a new one. Option values are ordered (ex. Small, Medium, Large) and affect how they are displayed.Show all...

taxonomy_type
object

The [taxonomy type] of this product.

preorderable
boolean

True when the product can be preordered. If this field is true, preorder_details will be non-null.

preorder_details
object

An object containing all the details for a preorderable product. null if preorderable is false.

product_attributes
array[object]

Object containing list of taxonomy attributes for the product *

made_in_country
string

Country of origin for the product *

page
integer

The current page number.

limit
integer

The maximum number of products per page.

updated_at_min
string

The minimum updated_at timestamp used to filter products.

cursor
string

A cursor for pagination. Use this value in subsequent requests to get the next page of results.

Auth
X-FAIRE-OAUTH-ACCESS-TOKEN
:
X-FAIRE-APP-CREDENTIALS
:
Parameters
cursor
:
include_deleted
:
Not Set
False
True
select an option
limit
:
page
:
sku
:
updated_at_min
:
Send API Request
Request Sample: Shell / cURL
curl --request GET \
  --url https://www.faire.com/external-api/v2/products \
  --header 'Accept: application/json' \
  --header 'X-FAIRE-APP-CREDENTIALS: 123' \
  --header 'X-FAIRE-OAUTH-ACCESS-TOKEN: 123'
Response Example
1
{
2
  "products": [
3
    {
4
      "id": "p_123",
5
      "created_at": "2019-03-14T00:09:15.000Z",
6
      "updated_at": "2019-03-15T00:09:15.000Z",
7
      "brand_id": "b_abc",
8
      "name": "Faire's fantastic candle",
9
      "description": "Glad you decided to read our description! We have significantly more characters to describe to you just how good our candles smell.",
10
      "short_description": "Our candles smell fantastic. Want to know how good? Read our description!",
11
      "sale_state": "FOR_SALE",
12
      "lifecycle_state": "DRAFT",
13
      "variants": [
14
        {
15
          "id": "po_abc123",
16
          "created_at": "2024-01-15T10:30:00Z",
17
          "updated_at": "2024-01-20T14:45:00Z",
18
          "product_id": "string",
19
          "name": "Vanilla Scent",
20
          "sale_state": "FOR_SALE",
21
          "lifecycle_state": "DRAFT",
22
          "idempotence_token": "rrc23negw",
23
          "sku": "vanilla-2019",
24
          "available_quantity": 42,
25
          "backordered_until": "20190208T000915.000Z",
26
          "wholesale_price_cents": 0,
27
          "retail_price_cents": 0,
28
          "tariff_code": "340600",
29
          "images": [
30
            {
31
              "id": "i_adqaiy3htm",
32
              "width": 1000,
33
              "height": 1000,
34
              "sequence": 0,
35
              "url": "https://cdn.faire.com/374cd3041a4c4.png",
36
              "original_url": "https://example.com/original-image.png",
37
              "tags": [
38
                "string"
39
              ]
40
            }
41
          ],
42
          "options": [
43
            {
44
              "name": "Scent",
45
              "value": "Vanilla"
46
            }
47
          ],
48
          "prices": [
49
            {
50
              "geo_constraint": {
51
                "country": "USA",
52
                "country_group": "EUROPEAN_UNION"
53
              },
54
              "wholesale_price": {
55
                "amount_minor": 4999,
56
                "currency": "USD"
57
              },
58
              "retail_price": {
59
                "amount_minor": 4999,
60
                "currency": "USD"
61
              }
62
            }
63
          ],
64
          "variant_preorder_details": {
65
            "expected_ship_date": "2021-05-21",
66
            "expected_ship_window_end_date": "2021-05-24",
67
            "stop_selling_at": 1619827200000
68
          },
69
          "measurements": {
70
            "mass_unit": "GRAMS",
71
            "weight": 1.5,
72
            "distance_unit": "CENTIMETERS",
73
            "length": 10.5,
74
            "width": 8,
75
            "height": 3.2
76
          },
77
          "gtin": "012345678905",
78
          "orderability_type": "IMMEDIATE",
79
          "case_measurements": {
80
            "mass_unit": "GRAMS",
81
            "weight": 1.5,
82
            "distance_unit": "CENTIMETERS",
83
            "length": 10.5,
84
            "width": 8,
85
            "height": 3.2
86
          }
87
        }
88
      ],
89
      "idempotence_token": "4aytry2ust",
90
      "unit_multiplier": 2,
91
      "minimum_order_quantity": 8,
92
      "per_style_minimum_order_quantity": 0,
93
      "allow_sales_when_out_of_stock": false,
94
      "images": [
95
        {
96
          "id": "i_adqaiy3htm",
97
          "width": 1000,
98
          "height": 1000,
99
          "sequence": 0,
100
          "url": "https://cdn.faire.com/374cd3041a4c4.png",
101
          "original_url": "https://example.com/original-image.png",
102
          "tags": [
103
            "string"
104
          ]
105
        }
106
      ],
107
      "variant_option_sets": [
108
        {
109
          "name": "Scent",
110
          "values": [
111
            "string"
112
          ]
113
        }
114
      ],
115
      "taxonomy_type": {
116
        "id": "string",
117
        "name": "string"
118
      },
119
      "preorderable": true,
120
      "preorder_details": {
121
        "order_by_date": "2021-04-01",
122
        "keep_active_past_order_by_date": false,
123
        "expected_ship_date": "2021-05-21",
124
        "expected_ship_window_end_date": "2021-05-24"
125
      },
126
      "product_attributes": [
127
        {
128
          "name": "Material",
129
          "value": "Cotton"
130
        }
131
      ],
132
      "made_in_country": "string"
133
    }
134
  ],
135
  "page": 0,
136
  "limit": 0,
137
  "updated_at_min": "string",
138
  "cursor": "string"
139
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/AddShipmentsRequestV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
AddShipmentsRequestV2

Request to add shipping information (tracking codes, carriers) for an order.

shipments
array[object]

A list of shipments to add to the order.

id
string

Read-only. A unique identifier of the shipment, beginning with "s_".

Example:
s_bq425ju5vh
created_at
string

Read-only. An ISO 8601 timestamp of when the shipment was created.

Example:
2019-03-15T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 timestamp of when the shipment was last updated.

Example:
2019-03-15T00:09:15.000Z
order_id
string

The ID of the order the shipment is attached to.

Example:
bo_bxdmjbwxid
maker_cost_cents
integer
deprecated

The cost the brand paid to ship the order, in USD cents. Deprecated - use makerCost instead.

carrier
string

The carrier the brand used to ship the order. Currently, the accepted values are CANADA_POST, DHL_ECOMMERCE, DHL_EXPRESS, FEDEX, PUROLATOR, UPS, USPS, POSTNL, CANPAR, INTERLINK_EXPRESS, GSO, ROYAL_MAIL, DPD, DPDUK, PARCELFORCE, AUSTRALIA_POST, EVRI, and LA_POSTE. These values are case insensitive. If another string is entered for this field, Faire will do its best to produce tracking information for that carrier, but may not succeed.

Example:
fedex
tracking_code
string

The tracking code for the shipment, format varies based on the carrier.

Example:
94029300101029282
maker_cost
object

The cost the brand paid to ship the order.

shipping_type
string

The type of shipping selected for this shipment (either SHIP_ON_YOUR_OWN or SHIP_WITH_FAIRE).

Allowed values:
SHIP_ON_YOUR_OWN
SHIP_WITH_FAIRE
shipping_label_url
string

A URL to the shipping label for this shipment, if available. This field is read-only.

Example:
https://cdn.faire.com/shipping-labels/label_abc123.pdf
Example
1
{
2
  "shipments": [
3
    {
4
      "id": "s_bq425ju5vh",
5
      "created_at": "2019-03-15T00:09:15.000Z",
6
      "updated_at": "2019-03-15T00:09:15.000Z",
7
      "order_id": "bo_bxdmjbwxid",
8
      "maker_cost_cents": 0,
9
      "carrier": "fedex",
10
      "tracking_code": "94029300101029282",
11
      "maker_cost": {},
12
      "shipping_type": "SHIP_ON_YOUR_OWN",
13
      "shipping_label_url": "https://cdn.faire.com/shipping-labels/label_abc123.pdf"
14
    }
15
  ]
16
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/CreateExternalPrepacksRequestV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
CreateExternalPrepacksRequestV2

Request to create one or more prepacks (multi-item packages sold as a unit).

prepacks
array[object]

A list of prepacks to create.

id
string

Read-only. A unique identifier of the prepack, beginning with "pc_".

Example:
pc_xyz789
idempotence_token
string

The identifier used for idempotence when this prepack was created.

Example:
prepack_abc123
created_at
string

Read-only. An ISO 8601 timestamp of when the prepack was created.

Example:
2019-03-14T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 timestamp of when the prepack was most recently updated.

Example:
2019-03-15T00:09:15.000Z
name
string

The name of the prepack.

Example:
Assorted Sizes Pack
description
string

A description of the prepack. The description is determined by the quantities and sizes of prepack items.

Example:
Pack includes 2 Small, 3 Medium, 2 Large
items
array[object]

A list of prepack items that belong to this prepack.

Example
1
{
2
  "prepacks": [
3
    {
4
      "id": "pc_xyz789",
5
      "idempotence_token": "prepack_abc123",
6
      "created_at": "2019-03-14T00:09:15.000Z",
7
      "updated_at": "2019-03-15T00:09:15.000Z",
8
      "name": "Assorted Sizes Pack",
9
      "description": "Pack includes 2 Small, 3 Medium, 2 Large",
10
      "items": [
11
        {}
12
      ]
13
    }
14
  ]
15
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/CreateExternalPrepacksResponseV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
CreateExternalPrepacksResponseV2

Response containing the created prepacks with their assigned IDs.

prepacks
array[object]

The list of created prepacks.

id
string

Read-only. A unique identifier of the prepack, beginning with "pc_".

Example:
pc_xyz789
idempotence_token
string

The identifier used for idempotence when this prepack was created.

Example:
prepack_abc123
created_at
string

Read-only. An ISO 8601 timestamp of when the prepack was created.

Example:
2019-03-14T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 timestamp of when the prepack was most recently updated.

Example:
2019-03-15T00:09:15.000Z
name
string

The name of the prepack.

Example:
Assorted Sizes Pack
description
string

A description of the prepack. The description is determined by the quantities and sizes of prepack items.

Example:
Pack includes 2 Small, 3 Medium, 2 Large
items
array[object]

A list of prepack items that belong to this prepack.

Example
1
{
2
  "prepacks": [
3
    {
4
      "id": "pc_xyz789",
5
      "idempotence_token": "prepack_abc123",
6
      "created_at": "2019-03-14T00:09:15.000Z",
7
      "updated_at": "2019-03-15T00:09:15.000Z",
8
      "name": "Assorted Sizes Pack",
9
      "description": "Pack includes 2 Small, 3 Medium, 2 Large",
10
      "items": [
11
        {}
12
      ]
13
    }
14
  ]
15
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/EditItemsAvailabilityRequestV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
EditItemsAvailabilityRequestV2

Request to update the availability status of product variants (quantity, discontinued status, backorder date).

availabilities
dictionary[string, object]
available_quantity
integer

The current available quantity for the item. The valid range is [0, orderedQuantity).

discontinued
boolean

If true, the item was discontinued and cannot be ordered again in the future.

backordered_until
string

An ISO 8601 timestamp of when the item will be back in stock.

Example
1
{
2
  "availabilities": {
3
    "property1": {
4
      "available_quantity": 0,
5
      "discontinued": true,
6
      "backordered_until": "string"
7
    },
8
    "property2": {
9
      "available_quantity": 0,
10
      "discontinued": true,
11
      "backordered_until": "string"
12
    }
13
  }
14
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/EditItemsAvailabilityRequestV2.ItemAvailability

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
EditItemsAvailabilityRequestV2.ItemAvailability

Availability information for a single product variant.

available_quantity
integer

The current available quantity for the item. The valid range is [0, orderedQuantity).

discontinued
boolean

If true, the item was discontinued and cannot be ordered again in the future.

backordered_until
string

An ISO 8601 timestamp of when the item will be back in stock.

Example
1
{
2
  "available_quantity": 0,
3
  "discontinued": true,
4
  "backordered_until": "string"
5
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalAddressV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalAddressV2

Contains information about the location of a person or business. Typically used to describe where to ship an order.

id
string

Read-only. The unique identifier of the address, beginning with "a_".

Example:
a_abc123def
name
string

The name of the individual (recipient) to contact at the address.

Example:
John Smith
address1
string

The first line of street address information.

Example:
41 King Street West
address2
string

Optional. The second line of street address information.

Example:
3rd Floor
postal_code
string

The ZIP/postal code.

Example:
N2G 1A1
city
string

The city name.

Example:
Kitchener
state
string

The full name of the state or province.

Example:
Ontario
state_code
string

The ISO 3166 two-letter code for the state or province.

Example:
ON
phone_number
string

The phone number used to contact the recipient.

Example:
555-123-4567
country
string

The full name of the country.

Example:
Canada
country_code
string

The ISO alpha-3 country code.

Example:
CAN
company_name
string

The name of the company at this address.

Example:
Faire Wholesale, Inc
address_type
string

Best effort attempt to map the address to am address type. This occurs asynchronously to it might not be populated.

Allowed values:
RESIDENTIAL
COMMERCIAL
MIXED
Example
1
{
2
  "id": "a_abc123def",
3
  "name": "John Smith",
4
  "address1": "41 King Street West",
5
  "address2": "3rd Floor",
6
  "postal_code": "N2G 1A1",
7
  "city": "Kitchener",
8
  "state": "Ontario",
9
  "state_code": "ON",
10
  "phone_number": "555-123-4567",
11
  "country": "Canada",
12
  "country_code": "CAN",
13
  "company_name": "Faire Wholesale, Inc",
14
  "address_type": "RESIDENTIAL"
15
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalAddressV2.AddressType

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalAddressV2.AddressType
string

These are different address specifications.

Allowed values:
RESIDENTIAL
COMMERCIAL
MIXED
Example
1
RESIDENTIAL
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalCancelBrandOrderRequestV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalCancelBrandOrderRequestV2

Request to cancel an order, including the reason and an optional note.

note
string

A note explaining to the retailer why their order was canceled. The note must be between 30 and 1000 characters long.

reason
string

The reason for canceling the order.

Allowed values:
REQUESTED_BY_RETAILER
RETAILER_NOT_GOOD_FIT
CHANGE_REPLACE_ORDER
ITEM_OUT_OF_STOCK
INCORRECT_PRICING
ORDER_TOO_SMALL
REJECT_INTERNATIONAL_ORDER
OTHER
Example
1
{
2
  "note": "string",
3
  "reason": "REQUESTED_BY_RETAILER"
4
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalDiscountV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalDiscountV2
id
string

A unique identifier for the discount, beginning with "bpc_".

Example:
bpc_k3w2kb97tp
code
string

The name of the promotion as it appears to retailers at checkout.

Example:
SUMMER10
discount_type
string

This is PERCENTAGE, FLAT_AMOUNT, or NONE depending on how the discount is calculated. A discount of type NONE means that this discount affected something other than the purchase price, such as free shipping or duties.

Allowed values:
FLAT_AMOUNT
PERCENTAGE
NONE
discount_amount_cents
integer
deprecated

Deprecated. Depending on discountType either discountAmountCents or discountPercentage is populated.

discount_percentage
number

The discount amount as a percent of the total. This value is present only when the discount_type is PERCENTAGE.

Example:
10
includes_free_shipping
boolean

Whether this promotion is for free shipping.

Example:
false
discount_amount
object

The amount of money for the discount. This value is present only when the discount_type is FLAT_AMOUNT.

amount_minor
integer

The amount of money in the smallest unit of the applicable currency. For example, US dollars is in cents.

Example:
4999
currency
string

The type of currency involved in the current payment in ISO 4217 format. For example, US dollars is USD.

Example:
USD
Example
1
{
2
  "id": "bpc_k3w2kb97tp",
3
  "code": "SUMMER10",
4
  "discount_type": "FLAT_AMOUNT",
5
  "discount_amount_cents": 0,
6
  "discount_percentage": 10,
7
  "includes_free_shipping": false,
8
  "discount_amount": {
9
    "amount_minor": 4999,
10
    "currency": "USD"
11
  }
12
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalDiscountV2.DiscountType

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalDiscountV2.DiscountType
string

The type of discount applied - either a flat amount off or a percentage off the order.

Allowed values:
FLAT_AMOUNT
PERCENTAGE
NONE
Example
1
FLAT_AMOUNT
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalDistanceUnitV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalDistanceUnitV2
string

Distance units.

Allowed values:
CENTIMETERS
INCHES
FEET
MILLIMETERS
METERS
YARDS
Example
1
CENTIMETERS
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalImageV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalImageV2

Details about an image.

id
string

Read-only. The unique identifier of the image, beginning with "i_".

Example:
i_adqaiy3htm
width
integer

Read-only. The width of the image in pixels.

Example:
1000
height
integer

Read-only. The height of the image in pixels.

Example:
1000
sequence
integer

The ordering to display the image when it is part of a collection of images.

Example:
0
url
string

The URL for the image file. When provided as an input, Faire will attempt to download the image and host it on the Faire CDN. If it fails to download, Faire will attempt to serve the original image URL.

Example:
https://cdn.faire.com/374cd3041a4c4.png
original_url
string

[READ-ONLY] The original url passed in for this image.

Example:
https://example.com/original-image.png
tags
array[string]

TODO: Document. What are tags? Are they an input?

Example
1
{
2
  "id": "i_adqaiy3htm",
3
  "width": 1000,
4
  "height": 1000,
5
  "sequence": 0,
6
  "url": "https://cdn.faire.com/374cd3041a4c4.png",
7
  "original_url": "https://example.com/original-image.png",
8
  "tags": [
9
    "string"
10
  ]
11
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalInventoryQuantity

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalInventoryQuantity
type
string

Type of this quantity @see Type

Allowed values:
QUANTITY
UNTRACKED
quantity
integer

Quantity of inventory. Negative values imply oversold content.

Example:
42
Example
1
{
2
  "type": "QUANTITY",
3
  "quantity": 42
4
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalInventoryQuantity.Type

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalInventoryQuantity.Type
string
Allowed values:
QUANTITY
UNTRACKED
Example
1
QUANTITY
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalMassUnitV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalMassUnitV2
string

Mass units.

Allowed values:
GRAMS
KILOGRAMS
OUNCES
POUNDS
Example
1
GRAMS
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalMeasurementsV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalMeasurementsV2

Contains information about weight and dimensions.

mass_unit
string

The unit that is used for weight. massUnit is set if and only if weight is set.

Allowed values:
GRAMS
KILOGRAMS
OUNCES
POUNDS
weight
number

Weight, with unit specified by massUnit.

Example:
1.5
distance_unit
string

The unit that is used for length, width and height. distanceUnit is set if and only if at least one of length, width or height is set.

Allowed values:
CENTIMETERS
INCHES
FEET
MILLIMETERS
METERS
YARDS
length
number

Length, with unit specified by distanceUnit.

Example:
10.5
width
number

Width, with unit specified by distanceUnit.

Example:
8
height
number

Height, with unit specified by distanceUnit.

Example:
3.2
Example
1
{
2
  "mass_unit": "GRAMS",
3
  "weight": 1.5,
4
  "distance_unit": "CENTIMETERS",
5
  "length": 10.5,
6
  "width": 8,
7
  "height": 3.2
8
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalMoneyV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalMoneyV2

Represents a monetary amount with currency. All monetary values in the API use this structure. The amount is stored in the smallest unit (e.g., cents for USD) to avoid floating point precision issues.

amount_minor
integer

The amount of money in the smallest unit of the applicable currency. For example, US dollars is in cents.

Example:
4999
currency
string

The type of currency involved in the current payment in ISO 4217 format. For example, US dollars is USD.

Example:
USD
Example
1
{
2
  "amount_minor": 4999,
3
  "currency": "USD"
4
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalOrderItemV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalOrderItemV2
id
string

Read-only. A unique identifier of the order item, beginning with "oi_".

Example:
oi_bq425ju5vh
created_at
string

Read-only. An ISO 8601 timestamp of when the order item was created.

Example:
2019-03-15T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 timestamp of when the order item was last updated.

Example:
2019-03-15T00:09:15.000Z
order_id
string

The ID of the order the item belongs to.

Example:
bo_bxdmjbwxid
product_id
string

The ID of the product the retailer bought.

Example:
p_fccaefnahr
variant_id
string

The ID of the variant the retailer bought.

Example:
po_3745tjzrpc
quantity
integer

The number of physical items the retailer purchased.

Example:
1
sku
string

The SKU of the variant when the order was created. This may not match the current SKU of the variant.

Example:
goldenretriever
price_cents
integer
deprecated

The wholesale price of the product at the time it was purchased, in USD cents. Deprecated - use price instead.

product_name
string

The name of the product when it was purchased.

Example:
Golden Dog
variant_name
string

The name of the variant when it was purchased.

Example:
retriever
includes_tester
boolean

A boolean indicating whether or not a tester for the variant was purchased.

Example:
false
tester_price_cents
integer
deprecated

If includes_tester is true, the price of the tester in USD cents. Deprecated - use testerPrice instead.

customizations
array[object]

A list of customizations applied to this order item.

token
string

The unique token identifying this customization.

Example:
custom_abc123
type
string

The type of customization.

Example:
text
value
string

The value or content of the customization.

Example:
Happy Birthday!
price
object

The wholesale price of the item at the time it was purchased.

amount_minor
integer

The amount of money in the smallest unit of the applicable currency. For example, US dollars is in cents.

Example:
4999
currency
string

The type of currency involved in the current payment in ISO 4217 format. For example, US dollars is USD.

Example:
USD
tester_price
object

If includes_tester is true, the price of the tester.

amount_minor
integer

The amount of money in the smallest unit of the applicable currency. For example, US dollars is in cents.

Example:
4999
currency
string

The type of currency involved in the current payment in ISO 4217 format. For example, US dollars is USD.

Example:
USD
discounts
array[object]

A list of any product-specific promotions that were applied to this item. Does not include shop-wide promotions, which can be found under the order's brand_discounts field.

id
string

A unique identifier for the discount, beginning with "bpc_".

Example:
bpc_k3w2kb97tp
code
string

The name of the promotion as it appears to retailers at checkout.

Example:
SUMMER10
discount_type
string

This is PERCENTAGE, FLAT_AMOUNT, or NONE depending on how the discount is calculated. A discount of type NONE means that this discount affected something other than the purchase price, such as free shipping or duties.

Allowed values:
FLAT_AMOUNT
PERCENTAGE
NONE
discount_amount_cents
integer
deprecated

Deprecated. Depending on discountType either discountAmountCents or discountPercentage is populated.

discount_percentage
number

The discount amount as a percent of the total. This value is present only when the discount_type is PERCENTAGE.

Example:
10
includes_free_shipping
boolean

Whether this promotion is for free shipping.

Example:
false
discount_amount
object

The amount of money for the discount. This value is present only when the discount_type is FLAT_AMOUNT.

state
string

The current state of the order item.

Allowed values:
CANCELED
PROCESSING
PRE_TRANSIT
IN_TRANSIT
DELIVERED
RETURNED
BACKORDERED
DAMAGED_OR_MISSING
PENDING_RETAILER_CONFIRMATION
Example
1
{
2
  "id": "oi_bq425ju5vh",
3
  "created_at": "2019-03-15T00:09:15.000Z",
4
  "updated_at": "2019-03-15T00:09:15.000Z",
5
  "order_id": "bo_bxdmjbwxid",
6
  "product_id": "p_fccaefnahr",
7
  "variant_id": "po_3745tjzrpc",
8
  "quantity": 1,
9
  "sku": "goldenretriever",
10
  "price_cents": 0,
11
  "product_name": "Golden Dog",
12
  "variant_name": "retriever",
13
  "includes_tester": false,
14
  "tester_price_cents": 0,
15
  "customizations": [
16
    {
17
      "token": "custom_abc123",
18
      "type": "text",
19
      "value": "Happy Birthday!"
20
    }
21
  ],
22
  "price": {
23
    "amount_minor": 4999,
24
    "currency": "USD"
25
  },
26
  "tester_price": {
27
    "amount_minor": 4999,
28
    "currency": "USD"
29
  },
30
  "discounts": [
31
    {
32
      "id": "bpc_k3w2kb97tp",
33
      "code": "SUMMER10",
34
      "discount_type": "FLAT_AMOUNT",
35
      "discount_amount_cents": 0,
36
      "discount_percentage": 10,
37
      "includes_free_shipping": false,
38
      "discount_amount": {}
39
    }
40
  ],
41
  "state": "CANCELED"
42
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalOrderItemV2.Customization

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalOrderItemV2.Customization

Information about a customization on an order item.

token
string

The unique token identifying this customization.

Example:
custom_abc123
type
string

The type of customization.

Example:
text
value
string

The value or content of the customization.

Example:
Happy Birthday!
Example
1
{
2
  "token": "custom_abc123",
3
  "type": "text",
4
  "value": "Happy Birthday!"
5
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalOrderItemV2.State

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalOrderItemV2.State
string
Allowed values:
CANCELED
PROCESSING
PRE_TRANSIT
IN_TRANSIT
DELIVERED
RETURNED
BACKORDERED
DAMAGED_OR_MISSING
PENDING_RETAILER_CONFIRMATION
Example
1
CANCELED
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalOrderV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalOrderV2

Internally maps to a brand order.

id
string

Read-only. A unique identifier of the order, beginning with "bo_". NOTE: When shown on the Faire website, the "bo_" will be stripped and the order ID will be upper-case. e.g. "bo_bxdmjbwxid" appears as "#BXDMJBWXID" (See display_id).

Example:
bo_bxdmjbwxid
display_id
string

Read-only. The order identifier as displayed on the Faire website, emails, etc.

Example:
BXDMJBWXID
created_at
string

Read-only. An ISO 8601 timestamp of when the order was created.

Example:
2019-03-15T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 timestamp of when the order was last updated.

Example:
2019-03-15T00:10:00.000Z
state
string

The current state of the order.

Allowed values:
NEW
PROCESSING
PRE_TRANSIT
IN_TRANSIT
DELIVERED
CANCELED
BACKORDERED
PENDING_RETAILER_CONFIRMATION
items
array[object]

A list of order items associated with the order.

id
string

Read-only. A unique identifier of the order item, beginning with "oi_".

Example:
oi_bq425ju5vh
created_at
string

Read-only. An ISO 8601 timestamp of when the order item was created.

Example:
2019-03-15T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 timestamp of when the order item was last updated.

Example:
2019-03-15T00:09:15.000Z
order_id
string

The ID of the order the item belongs to.

Example:
bo_bxdmjbwxid
product_id
string

The ID of the product the retailer bought.

Example:
p_fccaefnahr
variant_id
string

The ID of the variant the retailer bought.

Example:
po_3745tjzrpc
quantity
integer

The number of physical items the retailer purchased.

Example:
1
sku
string

The SKU of the variant when the order was created. This may not match the current SKU of the variant.

Example:
goldenretriever
price_cents
integer
deprecated

The wholesale price of the product at the time it was purchased, in USD cents. Deprecated - use price instead.

product_name
string

The name of the product when it was purchased.

Example:
Golden Dog
variant_name
string

The name of the variant when it was purchased.

Example:
retriever
includes_tester
boolean

A boolean indicating whether or not a tester for the variant was purchased.

Example:
false
tester_price_cents
integer
deprecated

If includes_tester is true, the price of the tester in USD cents. Deprecated - use testerPrice instead.

customizations
array[object]

A list of customizations applied to this order item.

price
object

The wholesale price of the item at the time it was purchased.

tester_price
object

If includes_tester is true, the price of the tester.

discounts
array[object]

A list of any product-specific promotions that were applied to this item. Does not include shop-wide promotions, which can be found under the order's brand_discounts field.

state
string

The current state of the order item.

Allowed values:
CANCELED
PROCESSING
PRE_TRANSIT
IN_TRANSIT
DELIVERED
RETURNED
BACKORDERED
DAMAGED_OR_MISSING
PENDING_RETAILER_CONFIRMATION
shipments
array[object]

A list of shipments associated with the order.

id
string

Read-only. A unique identifier of the shipment, beginning with "s_".

Example:
s_bq425ju5vh
created_at
string

Read-only. An ISO 8601 timestamp of when the shipment was created.

Example:
2019-03-15T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 timestamp of when the shipment was last updated.

Example:
2019-03-15T00:09:15.000Z
order_id
string

The ID of the order the shipment is attached to.

Example:
bo_bxdmjbwxid
maker_cost_cents
integer
deprecated

The cost the brand paid to ship the order, in USD cents. Deprecated - use makerCost instead.

carrier
string

The carrier the brand used to ship the order. Currently, the accepted values are CANADA_POST, DHL_ECOMMERCE, DHL_EXPRESS, FEDEX, PUROLATOR, UPS, USPS, POSTNL, CANPAR, INTERLINK_EXPRESS, GSO, ROYAL_MAIL, DPD, DPDUK, PARCELFORCE, AUSTRALIA_POST, EVRI, and LA_POSTE. These values are case insensitive. If another string is entered for this field, Faire will do its best to produce tracking information for that carrier, but may not succeed.

Example:
fedex
tracking_code
string

The tracking code for the shipment, format varies based on the carrier.

Example:
94029300101029282
maker_cost
object

The cost the brand paid to ship the order.

shipping_type
string

The type of shipping selected for this shipment (either SHIP_ON_YOUR_OWN or SHIP_WITH_FAIRE).

Allowed values:
SHIP_ON_YOUR_OWN
SHIP_WITH_FAIRE
shipping_label_url
string

A URL to the shipping label for this shipment, if available. This field is read-only.

Example:
https://cdn.faire.com/shipping-labels/label_abc123.pdf
address
object

The address the order should be shipped to.

id
string

Read-only. The unique identifier of the address, beginning with "a_".

Example:
a_abc123def
name
string

The name of the individual (recipient) to contact at the address.

Example:
John Smith
address1
string

The first line of street address information.

Example:
41 King Street West
address2
string

Optional. The second line of street address information.

Example:
3rd Floor
postal_code
string

The ZIP/postal code.

Example:
N2G 1A1
city
string

The city name.

Example:
Kitchener
state
string

The full name of the state or province.

Example:
Ontario
state_code
string

The ISO 3166 two-letter code for the state or province.

Example:
ON
phone_number
string

The phone number used to contact the recipient.

Example:
555-123-4567
country
string

The full name of the country.

Example:
Canada
country_code
string

The ISO alpha-3 country code.

Example:
CAN
company_name
string

The name of the company at this address.

Example:
Faire Wholesale, Inc
address_type
string

Best effort attempt to map the address to am address type. This occurs asynchronously to it might not be populated.

Allowed values:
RESIDENTIAL
COMMERCIAL
MIXED
ship_after
string

An ISO 8601 timestamp of the earliest the order should ship.

Example:
2019-03-15T00:09:15.000Z
payout_costs
object

The payout costs associated with the order. NOTE: This may change until the order has been paid out (payment_initiated_at is set), for example if items are removed from the order.

payout_fee_cents
integer
deprecated

The amount charged to the brand to pay out the order, (e.g. for next-day ACH transfers), in USD cents. Deprecated - use payoutFee instead.

payout_fee_bps
integer

The payout fee basis points used to calculate the payout fee (e.g. 300 is 3%).

Example:
0
payout_flat_fee
object

The payout flat fee amount charged in addition to payout_fee_bps.

commission_cents
integer
deprecated

The amount of commission charged to the brand for the order, in USD cents. Deprecated - use commission instead.

commission_bps
integer

The commission basis points used to calculate the commission (e.g. 1500 is 15%).

Example:
2500
commission_flat_fee
object

The commission flat fee amount (showing up as "New customer fee" in Faire brand portal) charged in addition to commission_bps.

payout_fee
object

The amount charged to the brand to pay out the order (e.g. for next-day ACH transfers). (item subtotal x payout_fee_bps + payout_flat_fee)

commission
object

The amount of commission charged to the brand for the order. (item subtotal x commission_bps + commission_flat_fee)

total_payout
object

The amount paid out to the brand after all fees and deductions.

payout_protection_fee
object

The amount charged to the brand for the Faire shipping protection program, if the brand is a participant.

damaged_and_missing_items
object

The amount deducted for any items reported missing or damaged in shipping.

net_tax
object

The amount of tax charged to the retailer and included in the payout.

shipping_subsidy
object

The amount charged to the brand for the free shipping partnership program, if the brand is a participant.

taxes
array[object]

A list of the individual taxes that make up net_tax.

subtotal_after_brand_discounts
object

The order subtotal after applying shop-wide discounts and product-specific discounts relevant to this order.

total_brand_discounts
object

The sum of all the shop-wide and product-specific discounts applied to this order.

payment_initiated_at
string

An ISO 8601 timestamp of when the brand was paid for this order. Null/absent if the order has not been paid yet.

Example:
2019-03-16T00:10:34.000Z
original_order_id
string

If this order has a parent, for example due to a backorder, this contains the ID of the original order. Null/absent otherwise.

Example:
bo_bg5ude6pmd
retailer_id
string

A unique identifier that represents the retailer who placed the order. See retailers for more information.

Example:
r_c9385ldj
source
string

How this order was initiated (may be MARKETPLACE, FAIRE_DIRECT, TRADESHOW, etc).

Example:
MARKETPLACE
expected_ship_date
string

If specified, an ISO 8601 timestamp of when the order is expected to be shipped.

customer
object
first_name
string

The first name of the customer.

Example:
John
last_name
string

The last name of the customer.

Example:
Smith
brand_discounts
array[object]

A list of any shop-wide promotions that were applied to this order. Does not include product-specific discounts, which can be found under the discounts field of the relevant order item.

id
string

A unique identifier for the discount, beginning with "bpc_".

Example:
bpc_k3w2kb97tp
code
string

The name of the promotion as it appears to retailers at checkout.

Example:
SUMMER10
discount_type
string

This is PERCENTAGE, FLAT_AMOUNT, or NONE depending on how the discount is calculated. A discount of type NONE means that this discount affected something other than the purchase price, such as free shipping or duties.

Allowed values:
FLAT_AMOUNT
PERCENTAGE
NONE
discount_amount_cents
integer
deprecated

Deprecated. Depending on discountType either discountAmountCents or discountPercentage is populated.

discount_percentage
number

The discount amount as a percent of the total. This value is present only when the discount_type is PERCENTAGE.

Example:
10
includes_free_shipping
boolean

Whether this promotion is for free shipping.

Example:
false
discount_amount
object

The amount of money for the discount. This value is present only when the discount_type is FLAT_AMOUNT.

requested_ship_date
string

An ISO 8601 timestamp of when the retailer requested the order to be shipped.

processing_at
string

An ISO 8601 timestamp of when the order moved to PROCESSING state.

is_free_shipping
boolean

True if the order has free shipping of any kind, false otherwise.

Example:
true
free_shipping_reason
string

The reason the order has free shipping, if any.

Allowed values:
INSIDER_FREE_SHIPPING
FAIRE_DIRECT
BRAND_DISCOUNT
FIRST_ORDER
PROMO_CODE
FREE_SHIPPING_THRESHOLD
faire_covered_shipping_cost
object

The amount of the total shipping cost Faire is paying for, if applicable.

amount_minor
integer

The amount of money in the smallest unit of the applicable currency. For example, US dollars is in cents.

Example:
4999
currency
string

The type of currency involved in the current payment in ISO 4217 format. For example, US dollars is USD.

Example:
USD
estimated_payout_at
string

An ISO 8601 timestamp of when Faire expects to pay the brand for the order. Note that this is not a guarantee of when the order will be paid out.

Example:
2019-03-16T00:00:00.000Z
is_fulfilled_by_faire
boolean

True if the order is fulfilled by Faire, false otherwise.

Example:
false
purchase_order_number
string

Purchase order number entered by retailer (free-text, not validated by Faire).

Example:
12345
notes
string

Brand-facing notes for the order. This field is free-text and may contain special requests or instructions from the retailer.

Example:
Please include a handwritten thank-you note
has_pending_retailer_cancellation_request
boolean

Indicates whether there is a pending cancellation request from the retailer for this order. This is true if the retailer has requested cancellation, the request has not been rejected, and the order is not already canceled.

sales_rep_name
string

The name of the brand sales rep attributed to this order

Example
1
{
2
  "id": "bo_bxdmjbwxid",
3
  "display_id": "BXDMJBWXID",
4
  "created_at": "2019-03-15T00:09:15.000Z",
5
  "updated_at": "2019-03-15T00:10:00.000Z",
6
  "state": "NEW",
7
  "items": [
8
    {
9
      "id": "oi_bq425ju5vh",
10
      "created_at": "2019-03-15T00:09:15.000Z",
11
      "updated_at": "2019-03-15T00:09:15.000Z",
12
      "order_id": "bo_bxdmjbwxid",
13
      "product_id": "p_fccaefnahr",
14
      "variant_id": "po_3745tjzrpc",
15
      "quantity": 1,
16
      "sku": "goldenretriever",
17
      "price_cents": 0,
18
      "product_name": "Golden Dog",
19
      "variant_name": "retriever",
20
      "includes_tester": false,
21
      "tester_price_cents": 0,
22
      "customizations": [
23
        {}
24
      ],
25
      "price": {},
26
      "tester_price": {},
27
      "discounts": [
28
        {}
29
      ],
30
      "state": "CANCELED"
31
    }
32
  ],
33
  "shipments": [
34
    {
35
      "id": "s_bq425ju5vh",
36
      "created_at": "2019-03-15T00:09:15.000Z",
37
      "updated_at": "2019-03-15T00:09:15.000Z",
38
      "order_id": "bo_bxdmjbwxid",
39
      "maker_cost_cents": 0,
40
      "carrier": "fedex",
41
      "tracking_code": "94029300101029282",
42
      "maker_cost": {},
43
      "shipping_type": "SHIP_ON_YOUR_OWN",
44
      "shipping_label_url": "https://cdn.faire.com/shipping-labels/label_abc123.pdf"
45
    }
46
  ],
47
  "address": {
48
    "id": "a_abc123def",
49
    "name": "John Smith",
50
    "address1": "41 King Street West",
51
    "address2": "3rd Floor",
52
    "postal_code": "N2G 1A1",
53
    "city": "Kitchener",
54
    "state": "Ontario",
55
    "state_code": "ON",
56
    "phone_number": "555-123-4567",
57
    "country": "Canada",
58
    "country_code": "CAN",
59
    "company_name": "Faire Wholesale, Inc",
60
    "address_type": "RESIDENTIAL"
61
  },
62
  "ship_after": "2019-03-15T00:09:15.000Z",
63
  "payout_costs": {
64
    "payout_fee_cents": 0,
65
    "payout_fee_bps": 0,
66
    "payout_flat_fee": {
67
      "amount_minor": 4999,
68
      "currency": "USD"
69
    },
70
    "commission_cents": 0,
71
    "commission_bps": 2500,
72
    "commission_flat_fee": {
73
      "amount_minor": 4999,
74
      "currency": "USD"
75
    },
76
    "payout_fee": {
77
      "amount_minor": 4999,
78
      "currency": "USD"
79
    },
80
    "commission": {
81
      "amount_minor": 4999,
82
      "currency": "USD"
83
    },
84
    "total_payout": {
85
      "amount_minor": 4999,
86
      "currency": "USD"
87
    },
88
    "payout_protection_fee": {
89
      "amount_minor": 4999,
90
      "currency": "USD"
91
    },
92
    "damaged_and_missing_items": {
93
      "amount_minor": 4999,
94
      "currency": "USD"
95
    },
96
    "net_tax": {
97
      "amount_minor": 4999,
98
      "currency": "USD"
99
    },
100
    "shipping_subsidy": {
101
      "amount_minor": 4999,
102
      "currency": "USD"
103
    },
104
    "taxes": [
105
      {
106
        "value": {}
107
      }
108
    ],
109
    "subtotal_after_brand_discounts": {
110
      "amount_minor": 4999,
111
      "currency": "USD"
112
    },
113
    "total_brand_discounts": {
114
      "amount_minor": 4999,
115
      "currency": "USD"
116
    }
117
  },
118
  "payment_initiated_at": "2019-03-16T00:10:34.000Z",
119
  "original_order_id": "bo_bg5ude6pmd",
120
  "retailer_id": "r_c9385ldj",
121
  "source": "MARKETPLACE",
122
  "expected_ship_date": "string",
123
  "customer": {
124
    "first_name": "John",
125
    "last_name": "Smith"
126
  },
127
  "brand_discounts": [
128
    {
129
      "id": "bpc_k3w2kb97tp",
130
      "code": "SUMMER10",
131
      "discount_type": "FLAT_AMOUNT",
132
      "discount_amount_cents": 0,
133
      "discount_percentage": 10,
134
      "includes_free_shipping": false,
135
      "discount_amount": {}
136
    }
137
  ],
138
  "requested_ship_date": "string",
139
  "processing_at": "string",
140
  "is_free_shipping": true,
141
  "free_shipping_reason": "INSIDER_FREE_SHIPPING",
142
  "faire_covered_shipping_cost": {
143
    "amount_minor": 4999,
144
    "currency": "USD"
145
  },
146
  "estimated_payout_at": "2019-03-16T00:00:00.000Z",
147
  "is_fulfilled_by_faire": false,
148
  "purchase_order_number": "12345",
149
  "notes": "Please include a handwritten thank-you note",
150
  "has_pending_retailer_cancellation_request": true,
151
  "sales_rep_name": "string"
152
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalOrderV2.CancelReason

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalOrderV2.CancelReason
string

Reasons why a brand may cancel an order. Used when calling the cancel order endpoint.

Allowed values:
REQUESTED_BY_RETAILER
RETAILER_NOT_GOOD_FIT
CHANGE_REPLACE_ORDER
ITEM_OUT_OF_STOCK
INCORRECT_PRICING
ORDER_TOO_SMALL
REJECT_INTERNATIONAL_ORDER
OTHER
Example
1
REQUESTED_BY_RETAILER
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalOrderV2.Customer

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalOrderV2.Customer
first_name
string

The first name of the customer.

Example:
John
last_name
string

The last name of the customer.

Example:
Smith
Example
1
{
2
  "first_name": "John",
3
  "last_name": "Smith"
4
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalOrderV2.ExternalFreeShippingReason

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalOrderV2.ExternalFreeShippingReason
string

The reason why an order qualifies for free shipping.

Allowed values:
INSIDER_FREE_SHIPPING
FAIRE_DIRECT
BRAND_DISCOUNT
FIRST_ORDER
PROMO_CODE
FREE_SHIPPING_THRESHOLD
Example
1
INSIDER_FREE_SHIPPING
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalOrderV2.State

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalOrderV2.State
string
Allowed values:
NEW
PROCESSING
PRE_TRANSIT
IN_TRANSIT
DELIVERED
CANCELED
BACKORDERED
PENDING_RETAILER_CONFIRMATION
Example
1
NEW
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalPayoutCostsV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalPayoutCostsV2
payout_fee_cents
integer
deprecated

The amount charged to the brand to pay out the order, (e.g. for next-day ACH transfers), in USD cents. Deprecated - use payoutFee instead.

payout_fee_bps
integer

The payout fee basis points used to calculate the payout fee (e.g. 300 is 3%).

Example:
0
payout_flat_fee
object

The payout flat fee amount charged in addition to payout_fee_bps.

amount_minor
integer

The amount of money in the smallest unit of the applicable currency. For example, US dollars is in cents.

Example:
4999
currency
string

The type of currency involved in the current payment in ISO 4217 format. For example, US dollars is USD.

Example:
USD
commission_cents
integer
deprecated

The amount of commission charged to the brand for the order, in USD cents. Deprecated - use commission instead.

commission_bps
integer

The commission basis points used to calculate the commission (e.g. 1500 is 15%).

Example:
2500
commission_flat_fee
object

The commission flat fee amount (showing up as "New customer fee" in Faire brand portal) charged in addition to commission_bps.

amount_minor
integer

The amount of money in the smallest unit of the applicable currency. For example, US dollars is in cents.

Example:
4999
currency
string

The type of currency involved in the current payment in ISO 4217 format. For example, US dollars is USD.

Example:
USD
payout_fee
object

The amount charged to the brand to pay out the order (e.g. for next-day ACH transfers). (item subtotal x payout_fee_bps + payout_flat_fee)

amount_minor
integer

The amount of money in the smallest unit of the applicable currency. For example, US dollars is in cents.

Example:
4999
currency
string

The type of currency involved in the current payment in ISO 4217 format. For example, US dollars is USD.

Example:
USD
commission
object

The amount of commission charged to the brand for the order. (item subtotal x commission_bps + commission_flat_fee)

amount_minor
integer

The amount of money in the smallest unit of the applicable currency. For example, US dollars is in cents.

Example:
4999
currency
string

The type of currency involved in the current payment in ISO 4217 format. For example, US dollars is USD.

Example:
USD
total_payout
object

The amount paid out to the brand after all fees and deductions.

amount_minor
integer

The amount of money in the smallest unit of the applicable currency. For example, US dollars is in cents.

Example:
4999
currency
string

The type of currency involved in the current payment in ISO 4217 format. For example, US dollars is USD.

Example:
USD
payout_protection_fee
object

The amount charged to the brand for the Faire shipping protection program, if the brand is a participant.

amount_minor
integer

The amount of money in the smallest unit of the applicable currency. For example, US dollars is in cents.

Example:
4999
currency
string

The type of currency involved in the current payment in ISO 4217 format. For example, US dollars is USD.

Example:
USD
damaged_and_missing_items
object

The amount deducted for any items reported missing or damaged in shipping.

amount_minor
integer

The amount of money in the smallest unit of the applicable currency. For example, US dollars is in cents.

Example:
4999
currency
string

The type of currency involved in the current payment in ISO 4217 format. For example, US dollars is USD.

Example:
USD
net_tax
object

The amount of tax charged to the retailer and included in the payout.

amount_minor
integer

The amount of money in the smallest unit of the applicable currency. For example, US dollars is in cents.

Example:
4999
currency
string

The type of currency involved in the current payment in ISO 4217 format. For example, US dollars is USD.

Example:
USD
shipping_subsidy
object

The amount charged to the brand for the free shipping partnership program, if the brand is a participant.

amount_minor
integer

The amount of money in the smallest unit of the applicable currency. For example, US dollars is in cents.

Example:
4999
currency
string

The type of currency involved in the current payment in ISO 4217 format. For example, US dollars is USD.

Example:
USD
taxes
array[object]

A list of the individual taxes that make up net_tax.

value
object

The amount of money for this tax.

taxable_item_type
string

The item to which this tax applies (e.g., ORDER_ITEM, SHIPPING).

Allowed values:
ORDER_ITEM
SHIPPING
INSIDER_MEMBERSHIP
ORDER_COMMISSION
ADS_CHARGE
tax_type
string

The type of tax being applied (e.g., VAT, GST, HST, PST, IMPORT_VAT, AUSTRALIA_GST, RECARGO).

Allowed values:
CANADIAN_TAX
VAT
VAT_REVERSE_CHARGE
INTRA_COMMUNITY_SUPPLY
GST
HST
PST
ESTIMATED_IMPORT_VAT
IMPORT_VAT
AUSTRALIA_GST
RECARGO
RECARGO_REVERSE_CHARGE
NEW_ZEALAND_GST
SALES_TAX
effect
string

Whether the value of this tax increases or decreases the payout.

Allowed values:
INCREASES_PAYOUT
DEDUCTED_FROM_PAYOUT
subtotal_after_brand_discounts
object

The order subtotal after applying shop-wide discounts and product-specific discounts relevant to this order.

amount_minor
integer

The amount of money in the smallest unit of the applicable currency. For example, US dollars is in cents.

Example:
4999
currency
string

The type of currency involved in the current payment in ISO 4217 format. For example, US dollars is USD.

Example:
USD
total_brand_discounts
object

The sum of all the shop-wide and product-specific discounts applied to this order.

amount_minor
integer

The amount of money in the smallest unit of the applicable currency. For example, US dollars is in cents.

Example:
4999
currency
string

The type of currency involved in the current payment in ISO 4217 format. For example, US dollars is USD.

Example:
USD
Example
1
{
2
  "payout_fee_cents": 0,
3
  "payout_fee_bps": 0,
4
  "payout_flat_fee": {
5
    "amount_minor": 4999,
6
    "currency": "USD"
7
  },
8
  "commission_cents": 0,
9
  "commission_bps": 2500,
10
  "commission_flat_fee": {
11
    "amount_minor": 4999,
12
    "currency": "USD"
13
  },
14
  "payout_fee": {
15
    "amount_minor": 4999,
16
    "currency": "USD"
17
  },
18
  "commission": {
19
    "amount_minor": 4999,
20
    "currency": "USD"
21
  },
22
  "total_payout": {
23
    "amount_minor": 4999,
24
    "currency": "USD"
25
  },
26
  "payout_protection_fee": {
27
    "amount_minor": 4999,
28
    "currency": "USD"
29
  },
30
  "damaged_and_missing_items": {
31
    "amount_minor": 4999,
32
    "currency": "USD"
33
  },
34
  "net_tax": {
35
    "amount_minor": 4999,
36
    "currency": "USD"
37
  },
38
  "shipping_subsidy": {
39
    "amount_minor": 4999,
40
    "currency": "USD"
41
  },
42
  "taxes": [
43
    {
44
      "value": {},
45
      "taxable_item_type": "ORDER_ITEM",
46
      "tax_type": "CANADIAN_TAX",
47
      "effect": "INCREASES_PAYOUT"
48
    }
49
  ],
50
  "subtotal_after_brand_discounts": {
51
    "amount_minor": 4999,
52
    "currency": "USD"
53
  },
54
  "total_brand_discounts": {
55
    "amount_minor": 4999,
56
    "currency": "USD"
57
  }
58
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalPrepackItemV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalPrepackItemV2
id
string

Read-only. A unique identifier of the prepack item, beginning with "pci_".

Example:
pci_abc456
created_at
string

Read-only. An ISO 8601 timestamp of when the item was created.

Example:
2019-03-14T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 timestamp of when the item was most recently updated.

Example:
2019-03-15T00:09:15.000Z
variant_id
string

The identifier of the variant for this prepack item.

Example:
po_3745tjzrpc
quantity
integer

The number of prepack items included in the prepack.

Example:
3
Example
1
{
2
  "id": "pci_abc456",
3
  "created_at": "2019-03-14T00:09:15.000Z",
4
  "updated_at": "2019-03-15T00:09:15.000Z",
5
  "variant_id": "po_3745tjzrpc",
6
  "quantity": 3
7
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalPrepackV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalPrepackV2
id
string

Read-only. A unique identifier of the prepack, beginning with "pc_".

Example:
pc_xyz789
idempotence_token
string

The identifier used for idempotence when this prepack was created.

Example:
prepack_abc123
created_at
string

Read-only. An ISO 8601 timestamp of when the prepack was created.

Example:
2019-03-14T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 timestamp of when the prepack was most recently updated.

Example:
2019-03-15T00:09:15.000Z
name
string

The name of the prepack.

Example:
Assorted Sizes Pack
description
string

A description of the prepack. The description is determined by the quantities and sizes of prepack items.

Example:
Pack includes 2 Small, 3 Medium, 2 Large
items
array[object]

A list of prepack items that belong to this prepack.

id
string

Read-only. A unique identifier of the prepack item, beginning with "pci_".

Example:
pci_abc456
created_at
string

Read-only. An ISO 8601 timestamp of when the item was created.

Example:
2019-03-14T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 timestamp of when the item was most recently updated.

Example:
2019-03-15T00:09:15.000Z
variant_id
string

The identifier of the variant for this prepack item.

Example:
po_3745tjzrpc
quantity
integer

The number of prepack items included in the prepack.

Example:
3
Example
1
{
2
  "id": "pc_xyz789",
3
  "idempotence_token": "prepack_abc123",
4
  "created_at": "2019-03-14T00:09:15.000Z",
5
  "updated_at": "2019-03-15T00:09:15.000Z",
6
  "name": "Assorted Sizes Pack",
7
  "description": "Pack includes 2 Small, 3 Medium, 2 Large",
8
  "items": [
9
    {
10
      "id": "pci_abc456",
11
      "created_at": "2019-03-14T00:09:15.000Z",
12
      "updated_at": "2019-03-15T00:09:15.000Z",
13
      "variant_id": "po_3745tjzrpc",
14
      "quantity": 3
15
    }
16
  ]
17
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalProductInfoV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalProductInfoV2
product_id
string
Example:
p_123
name
string
Example:
Faire's fantastic candle
Example
1
{
2
  "product_id": "p_123",
3
  "name": "Faire's fantastic candle"
4
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalProductReviewReplyV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalProductReviewReplyV2

A brand's reply to a product review.

comment
string
Example:
Thank you so much for your kind words! We're thrilled you love our candles.
created_at
string

An ISO 8601 extended timestamp of when the reply was created.

Example:
2019-04-17T00:00:00.000Z
Example
1
{
2
  "comment": "Thank you so much for your kind words! We're thrilled you love our candles.",
3
  "created_at": "2019-04-17T00:00:00.000Z"
4
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalProductReviewV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalProductReviewV2

Core product review data.

id
string
Example:
rev_abc123
rating
integer
Example:
5
comment
string
Example:
Love these candles! They smell amazing and last a long time.
brand_order_id
string
Example:
bo_bxdmjbwxid
created_at
string

An ISO 8601 extended timestamp of when the review was created.

Example:
2019-04-15T00:09:15.000Z
updated_at
string

An ISO 8601 extended timestamp of when the review was last updated.

Example:
2019-04-15T00:09:15.000Z
published_at
string

An ISO 8601 extended timestamp of when the review was published.

Example:
2019-04-16T00:00:00.000Z
images
array[object]
id
string

Read-only. The unique identifier of the image, beginning with "i_".

Example:
i_adqaiy3htm
width
integer

Read-only. The width of the image in pixels.

Example:
1000
height
integer

Read-only. The height of the image in pixels.

Example:
1000
sequence
integer

The ordering to display the image when it is part of a collection of images.

Example:
0
url
string

The URL for the image file. When provided as an input, Faire will attempt to download the image and host it on the Faire CDN. If it fails to download, Faire will attempt to serve the original image URL.

Example:
https://cdn.faire.com/374cd3041a4c4.png
original_url
string

[READ-ONLY] The original url passed in for this image.

Example:
https://example.com/original-image.png
tags
array[string]

TODO: Document. What are tags? Are they an input?

reply
object
comment
string
Example:
Thank you so much for your kind words! We're thrilled you love our candles.
created_at
string

An ISO 8601 extended timestamp of when the reply was created.

Example:
2019-04-17T00:00:00.000Z
Example
1
{
2
  "id": "rev_abc123",
3
  "rating": 5,
4
  "comment": "Love these candles! They smell amazing and last a long time.",
5
  "brand_order_id": "bo_bxdmjbwxid",
6
  "created_at": "2019-04-15T00:09:15.000Z",
7
  "updated_at": "2019-04-15T00:09:15.000Z",
8
  "published_at": "2019-04-16T00:00:00.000Z",
9
  "images": [
10
    {
11
      "id": "i_adqaiy3htm",
12
      "width": 1000,
13
      "height": 1000,
14
      "sequence": 0,
15
      "url": "https://cdn.faire.com/374cd3041a4c4.png",
16
      "original_url": "https://example.com/original-image.png",
17
      "tags": [
18
        null
19
      ]
20
    }
21
  ],
22
  "reply": {
23
    "comment": "Thank you so much for your kind words! We're thrilled you love our candles.",
24
    "created_at": "2019-04-17T00:00:00.000Z"
25
  }
26
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalProductReviewWithDetailsV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalProductReviewWithDetailsV2

A product review with all associated details.

product_review
object
id
string
Example:
rev_abc123
rating
integer
Example:
5
comment
string
Example:
Love these candles! They smell amazing and last a long time.
brand_order_id
string
Example:
bo_bxdmjbwxid
created_at
string

An ISO 8601 extended timestamp of when the review was created.

Example:
2019-04-15T00:09:15.000Z
updated_at
string

An ISO 8601 extended timestamp of when the review was last updated.

Example:
2019-04-15T00:09:15.000Z
published_at
string

An ISO 8601 extended timestamp of when the review was published.

Example:
2019-04-16T00:00:00.000Z
images
array[object]
reply
object
retailer_id
string
product_info
object
product_id
string
Example:
p_123
name
string
Example:
Faire's fantastic candle
Example
1
{
2
  "product_review": {
3
    "id": "rev_abc123",
4
    "rating": 5,
5
    "comment": "Love these candles! They smell amazing and last a long time.",
6
    "brand_order_id": "bo_bxdmjbwxid",
7
    "created_at": "2019-04-15T00:09:15.000Z",
8
    "updated_at": "2019-04-15T00:09:15.000Z",
9
    "published_at": "2019-04-16T00:00:00.000Z",
10
    "images": [
11
      {
12
        "tags": []
13
      }
14
    ],
15
    "reply": {
16
      "comment": "Thank you so much for your kind words! We're thrilled you love our candles.",
17
      "created_at": "2019-04-17T00:00:00.000Z"
18
    }
19
  },
20
  "retailer_id": "string",
21
  "product_info": {
22
    "product_id": "p_123",
23
    "name": "Faire's fantastic candle"
24
  }
25
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalProductTaxonomyAttributeV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalProductTaxonomyAttributeV2
name
string

The name of the taxonomy attribute.

Example:
Material
value
string

The value of the taxonomy attribute.

Example:
Cotton
Example
1
{
2
  "name": "Material",
3
  "value": "Cotton"
4
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalProductV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalProductV2
id
string

Read-only. The unique identifier of the product, beginning with "p_".

Example:
p_123
created_at
string

Read-only. An ISO 8601 extended timestamp of when the product was created.

Example:
2019-03-14T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 extended timestamp of when the product was last updated.

Example:
2019-03-15T00:09:15.000Z
brand_id
string

Read-only. A unique identifier of the brand that owns the product, beginning with "b_".

Example:
b_abc
name
string

The name of the product.

Example:
Faire's fantastic candle
description
string

A description of the product, at most 65,535 characters.

Example:
Glad you decided to read our description! We have significantly more characters to describe to you just how good our candles smell.
short_description
string

A short description of the product, at most 255 characters.

Example:
Our candles smell fantastic. Want to know how good? Read our description!
sale_state
string

Read-only. The current sellability of the product on Faire.

Allowed values:
FOR_SALE
SALES_PAUSED
lifecycle_state
string

Read-only. The current stage in the lifecycle of a product on Faire.

Allowed values:
DRAFT
PUBLISHED
UNPUBLISHED
DELETED
variants
array[object]

A list of product variants that belong to this product.

id
string

Read-only. The unique identifier of the variant, beginning with "po_".

Example:
po_abc123
created_at
string

Read-only. An ISO 8601 extended timestamp of when the variant was created.

Example:
2024-01-15T10:30:00Z
updated_at
string

Read-only. An ISO 8601 extended timestamp of when the variant was last updated.

Example:
2024-01-20T14:45:00Z
product_id
string

Read-only. The unique identifier of the product the variant belongs to, beginning with "p_".

name
string

The name of the variant.

Example:
Vanilla Scent
sale_state
string

Read-only. The current sellability of the variant on Faire.

Allowed values:
FOR_SALE
SALES_PAUSED
lifecycle_state
string

Read-only. The current stage in the lifecycle of a variant on Faire.

Allowed values:
DRAFT
PUBLISHED
UNPUBLISHED
DELETED
idempotence_token
string

TODO (bad docs): The identifier used when this variant was created.

Example:
rrc23negw
sku
string

An identifier that should be unique amongst variants. It is up to the client to keep SKUs unique. SKUs are case-sensitive.

Example:
vanilla-2019
available_quantity
integer

If set, the number of units available for sale. If not set in the response, the brand has not set their inventory levels in Faire.

Example:
42
backordered_until
string

If set, Faire will not allow the product option to be FOR_SALE until this date.

Example:
20190208T000915.000Z
wholesale_price_cents
integer
deprecated

The current wholesale price of a single unit of this variant in cents (US dollars). Deprecated - use prices instead.

retail_price_cents
integer
deprecated

The current recommended retailer price of a single unit of this option in cents (US dollars). Deprecated - use prices instead.

tariff_code
string

The tariff code (HS code) for this product variant.

Example:
340600
images
array[object]

The list of images associated with the variant.

options
array[object]

A set of options (attributes) that define this variant. For example, if the variant is a large red shirt, the options might include Color:Red and Size:Large. The options must be valid name/value pairs from the product's option_definitions.

prices
array[object]

All the available prices with currency for this variant, by geographic region.

variant_preorder_details
object

An object containing all the details for a preorderable variant. null if orderabilityType is IMMEDIATE.

measurements
object

Measurements for the product variant.

gtin
string

A Global Trade Item Number (GTIN) for the product variant. These are standardized codes issues by GS1 and include barcodes like UPC, ISBN, and EAN. GTINs must consist of only numbers, be 8, 12, 13, or 14 digits long, and have a valid check digit.

Example:
012345678905
orderability_type
string

Indicates whether the variant is available for sale immediately or if it is preorderable.

Allowed values:
IMMEDIATE
PREORDER
case_measurements
object

Case measurements for the product variant.

idempotence_token
string

TODO (bad docs): The identifier used when this product was created.

Example:
4aytry2ust
unit_multiplier
integer

Also known as case size or case quantity. This is the unit size that this product ships in. The product must be purchased in increments of this number.

Example:
2
minimum_order_quantity
integer

The minimum number of units required to purchase this product. Must be a multiple of the unit_multiplier.

Example:
8
per_style_minimum_order_quantity
integer

The minimum number of units of this product that can be ordered for the same "style". "Style" is defined as the set of variation values excluding the value for the "Size" variation. A product without a "Size" variation cannot use perStyleMinimumOrderQuantity.Show all...

Example:
0
allow_sales_when_out_of_stock
boolean

determines if the state of the options can be SALES_PAUSED for stock reasons

Example:
false
images
array[object]

The list of [images] associated with the product.

id
string

Read-only. The unique identifier of the image, beginning with "i_".

Example:
i_adqaiy3htm
width
integer

Read-only. The width of the image in pixels.

Example:
1000
height
integer

Read-only. The height of the image in pixels.

Example:
1000
sequence
integer

The ordering to display the image when it is part of a collection of images.

Example:
0
url
string

The URL for the image file. When provided as an input, Faire will attempt to download the image and host it on the Faire CDN. If it fails to download, Faire will attempt to serve the original image URL.

Example:
https://cdn.faire.com/374cd3041a4c4.png
original_url
string

[READ-ONLY] The original url passed in for this image.

Example:
https://example.com/original-image.png
tags
array[string]

TODO: Document. What are tags? Are they an input?

variant_option_sets
array[object]

A list of the different available options (attributes) used to compose variants. Products can only have the available option names defined on creation. If you want to redefine a product to have an additional option dimension, you must delete this product and create a new one. Option values are ordered (ex. Small, Medium, Large) and affect how they are displayed.Show all...

name
string

The name of the option (e.g., "Size", "Color").

Example:
Scent
values
array[string]

The available values for this option (e.g., ["Small", "Medium", "Large"]).

taxonomy_type
object

The [taxonomy type] of this product.

id
string

The unique identifier of the taxonomy type.

name
string

The human-readable name of the taxonomy type.

preorderable
boolean

True when the product can be preordered. If this field is true, preorder_details will be non-null.

preorder_details
object

An object containing all the details for a preorderable product. null if preorderable is false.

order_by_date
string

An ISO 8601 extended timestamp representing the latest date this product can be preordered.

Example:
2021-04-01
keep_active_past_order_by_date
boolean

Boolean that, when true, will keep products active past their orderByDate. Products are auto deactivated at the order by date. Setting this flag to true avoids this auto deactivation and the product to be explicitly deactivated. When a product reaches the order by date and this flag is true, the product remains active and it can still be preordered before start ship date, and ordered as a regular order after the start ship date.

Example:
false
expected_ship_date
string

An ISO 8601 extended timestamp representing the start of the shipping window for this preorder product.

Example:
2021-05-21
expected_ship_window_end_date
string

An ISO 8601 extended timestamp representing the end of the shipping window for this preorder product.

Example:
2021-05-24
product_attributes
array[object]

Object containing list of taxonomy attributes for the product *

name
string

The name of the taxonomy attribute.

Example:
Material
value
string

The value of the taxonomy attribute.

Example:
Cotton
made_in_country
string

Country of origin for the product *

Example
1
{
2
  "id": "p_123",
3
  "created_at": "2019-03-14T00:09:15.000Z",
4
  "updated_at": "2019-03-15T00:09:15.000Z",
5
  "brand_id": "b_abc",
6
  "name": "Faire's fantastic candle",
7
  "description": "Glad you decided to read our description! We have significantly more characters to describe to you just how good our candles smell.",
8
  "short_description": "Our candles smell fantastic. Want to know how good? Read our description!",
9
  "sale_state": "FOR_SALE",
10
  "lifecycle_state": "DRAFT",
11
  "variants": [
12
    {
13
      "id": "po_abc123",
14
      "created_at": "2024-01-15T10:30:00Z",
15
      "updated_at": "2024-01-20T14:45:00Z",
16
      "product_id": "string",
17
      "name": "Vanilla Scent",
18
      "sale_state": "FOR_SALE",
19
      "lifecycle_state": "DRAFT",
20
      "idempotence_token": "rrc23negw",
21
      "sku": "vanilla-2019",
22
      "available_quantity": 42,
23
      "backordered_until": "20190208T000915.000Z",
24
      "wholesale_price_cents": 0,
25
      "retail_price_cents": 0,
26
      "tariff_code": "340600",
27
      "images": [
28
        {}
29
      ],
30
      "options": [
31
        {}
32
      ],
33
      "prices": [
34
        {}
35
      ],
36
      "variant_preorder_details": {},
37
      "measurements": {},
38
      "gtin": "012345678905",
39
      "orderability_type": "IMMEDIATE",
40
      "case_measurements": {}
41
    }
42
  ],
43
  "idempotence_token": "4aytry2ust",
44
  "unit_multiplier": 2,
45
  "minimum_order_quantity": 8,
46
  "per_style_minimum_order_quantity": 0,
47
  "allow_sales_when_out_of_stock": false,
48
  "images": [
49
    {
50
      "id": "i_adqaiy3htm",
51
      "width": 1000,
52
      "height": 1000,
53
      "sequence": 0,
54
      "url": "https://cdn.faire.com/374cd3041a4c4.png",
55
      "original_url": "https://example.com/original-image.png",
56
      "tags": [
57
        null
58
      ]
59
    }
60
  ],
61
  "variant_option_sets": [
62
    {
63
      "name": "Scent",
64
      "values": [
65
        null
66
      ]
67
    }
68
  ],
69
  "taxonomy_type": {
70
    "id": "string",
71
    "name": "string"
72
  },
73
  "preorderable": true,
74
  "preorder_details": {
75
    "order_by_date": "2021-04-01",
76
    "keep_active_past_order_by_date": false,
77
    "expected_ship_date": "2021-05-21",
78
    "expected_ship_window_end_date": "2021-05-24"
79
  },
80
  "product_attributes": [
81
    {
82
      "name": "Material",
83
      "value": "Cotton"
84
    }
85
  ],
86
  "made_in_country": "string"
87
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalProductV2.LifecycleState

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalProductV2.LifecycleState
string

The current stage in the lifecycle of a product on Faire.

Allowed values:
DRAFT
PUBLISHED
UNPUBLISHED
DELETED
Example
1
DRAFT
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalProductV2.PreorderDetails

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalProductV2.PreorderDetails

An object containing all the details for a preorderable product.

order_by_date
string

An ISO 8601 extended timestamp representing the latest date this product can be preordered.

Example:
2021-04-01
keep_active_past_order_by_date
boolean

Boolean that, when true, will keep products active past their orderByDate. Products are auto deactivated at the order by date. Setting this flag to true avoids this auto deactivation and the product to be explicitly deactivated. When a product reaches the order by date and this flag is true, the product remains active and it can still be preordered before start ship date, and ordered as a regular order after the start ship date.

Example:
false
expected_ship_date
string

An ISO 8601 extended timestamp representing the start of the shipping window for this preorder product.

Example:
2021-05-21
expected_ship_window_end_date
string

An ISO 8601 extended timestamp representing the end of the shipping window for this preorder product.

Example:
2021-05-24
Example
1
{
2
  "order_by_date": "2021-04-01",
3
  "keep_active_past_order_by_date": false,
4
  "expected_ship_date": "2021-05-21",
5
  "expected_ship_window_end_date": "2021-05-24"
6
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalProductV2.SaleState

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalProductV2.SaleState
string

Read-only. The current sellability of the product option on Faire.

Allowed values:
FOR_SALE
SALES_PAUSED
Example
1
FOR_SALE
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalProductVariantInventory

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalProductVariantInventory
on_hand_quantity
object

The number of units physically on hand with the brand. This can be untracked or negative.

type
string

Type of this quantity @see Type

Allowed values:
QUANTITY
UNTRACKED
quantity
integer

Quantity of inventory. Negative values imply oversold content.

Example:
42
committed_quantity
object

The number of units allocated for unfulfilled orders. This must be a non-negative quantity.

type
string

Type of this quantity @see Type

Allowed values:
QUANTITY
UNTRACKED
quantity
integer

Quantity of inventory. Negative values imply oversold content.

Example:
42
available_quantity
object

The number of units available for purchase. This can be untracked or negative. Defined as (onHandQuantity - committedQuantity)

type
string

Type of this quantity @see Type

Allowed values:
QUANTITY
UNTRACKED
quantity
integer

Quantity of inventory. Negative values imply oversold content.

Example:
42
Example
1
{
2
  "on_hand_quantity": {
3
    "type": "QUANTITY",
4
    "quantity": 42
5
  },
6
  "committed_quantity": {
7
    "type": "QUANTITY",
8
    "quantity": 42
9
  },
10
  "available_quantity": {
11
    "type": "QUANTITY",
12
    "quantity": 42
13
  }
14
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalProductVariantOptionDefinitionV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalProductVariantOptionDefinitionV2

Note: The map entry keys (names) must be unique, but we cannot enforce this with protos.

name
string

The name of the option (e.g., "Size", "Color").

Example:
Scent
values
array[string]

The available values for this option (e.g., ["Small", "Medium", "Large"]).

Example
1
{
2
  "name": "Scent",
3
  "values": [
4
    "string"
5
  ]
6
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalProductVariantOptionV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalProductVariantOptionV2
name
string

The name of the option (e.g., "Size", "Color").

Example:
Scent
value
string

The value of the option for this variant (e.g., "Large", "Red").

Example:
Vanilla
Example
1
{
2
  "name": "Scent",
3
  "value": "Vanilla"
4
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalProductVariantV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalProductVariantV2

All products have one or more variants, which represent an combination of options defining that product. Variants can be differentiated by SKU, have their own inventory levels, and be backordered or deactivated independently of other variants.

A product's variants can be different choices along one dimension, such as size variants that are small, medium, or large. More complex products may have choices spanning two or more dimensions. The arrangement of the dimensions and choices can be configured with the option_definitions of the product.

id
string

Read-only. The unique identifier of the variant, beginning with "po_".

Example:
po_abc123
created_at
string

Read-only. An ISO 8601 extended timestamp of when the variant was created.

Example:
2024-01-15T10:30:00Z
updated_at
string

Read-only. An ISO 8601 extended timestamp of when the variant was last updated.

Example:
2024-01-20T14:45:00Z
product_id
string

Read-only. The unique identifier of the product the variant belongs to, beginning with "p_".

name
string

The name of the variant.

Example:
Vanilla Scent
sale_state
string

Read-only. The current sellability of the variant on Faire.

Allowed values:
FOR_SALE
SALES_PAUSED
lifecycle_state
string

Read-only. The current stage in the lifecycle of a variant on Faire.

Allowed values:
DRAFT
PUBLISHED
UNPUBLISHED
DELETED
idempotence_token
string

TODO (bad docs): The identifier used when this variant was created.

Example:
rrc23negw
sku
string

An identifier that should be unique amongst variants. It is up to the client to keep SKUs unique. SKUs are case-sensitive.

Example:
vanilla-2019
available_quantity
integer

If set, the number of units available for sale. If not set in the response, the brand has not set their inventory levels in Faire.

Example:
42
backordered_until
string

If set, Faire will not allow the product option to be FOR_SALE until this date.

Example:
20190208T000915.000Z
wholesale_price_cents
integer
deprecated

The current wholesale price of a single unit of this variant in cents (US dollars). Deprecated - use prices instead.

retail_price_cents
integer
deprecated

The current recommended retailer price of a single unit of this option in cents (US dollars). Deprecated - use prices instead.

tariff_code
string

The tariff code (HS code) for this product variant.

Example:
340600
images
array[object]

The list of images associated with the variant.

id
string

Read-only. The unique identifier of the image, beginning with "i_".

Example:
i_adqaiy3htm
width
integer

Read-only. The width of the image in pixels.

Example:
1000
height
integer

Read-only. The height of the image in pixels.

Example:
1000
sequence
integer

The ordering to display the image when it is part of a collection of images.

Example:
0
url
string

The URL for the image file. When provided as an input, Faire will attempt to download the image and host it on the Faire CDN. If it fails to download, Faire will attempt to serve the original image URL.

Example:
https://cdn.faire.com/374cd3041a4c4.png
original_url
string

[READ-ONLY] The original url passed in for this image.

Example:
https://example.com/original-image.png
tags
array[string]

TODO: Document. What are tags? Are they an input?

options
array[object]

A set of options (attributes) that define this variant. For example, if the variant is a large red shirt, the options might include Color:Red and Size:Large. The options must be valid name/value pairs from the product's option_definitions.

name
string

The name of the option (e.g., "Size", "Color").

Example:
Scent
value
string

The value of the option for this variant (e.g., "Large", "Red").

Example:
Vanilla
prices
array[object]

All the available prices with currency for this variant, by geographic region.

geo_constraint
object

Geographic constraint indicating where this price applies.

wholesale_price
object

The wholesale price for this geographic region.

retail_price
object

The recommended retail price for this geographic region.

variant_preorder_details
object

An object containing all the details for a preorderable variant. null if orderabilityType is IMMEDIATE.

expected_ship_date
string

An ISO 8601 extended timestamp representing the start of the shipping window for this preorder Option.

Example:
2021-05-21
expected_ship_window_end_date
string

An ISO 8601 extended timestamp representing the end of the shipping window for this preorder Option.

Example:
2021-05-24
stop_selling_at
integer

The date past which this Option will cease to be sold (gets de-listed).

Example:
1619827200000
measurements
object

Measurements for the product variant.

mass_unit
string

The unit that is used for weight. massUnit is set if and only if weight is set.

Allowed values:
GRAMS
KILOGRAMS
OUNCES
POUNDS
weight
number

Weight, with unit specified by massUnit.

Example:
1.5
distance_unit
string

The unit that is used for length, width and height. distanceUnit is set if and only if at least one of length, width or height is set.

Allowed values:
CENTIMETERS
INCHES
FEET
MILLIMETERS
METERS
YARDS
length
number

Length, with unit specified by distanceUnit.

Example:
10.5
width
number

Width, with unit specified by distanceUnit.

Example:
8
height
number

Height, with unit specified by distanceUnit.

Example:
3.2
gtin
string

A Global Trade Item Number (GTIN) for the product variant. These are standardized codes issues by GS1 and include barcodes like UPC, ISBN, and EAN. GTINs must consist of only numbers, be 8, 12, 13, or 14 digits long, and have a valid check digit.

Example:
012345678905
orderability_type
string

Indicates whether the variant is available for sale immediately or if it is preorderable.

Allowed values:
IMMEDIATE
PREORDER
case_measurements
object

Case measurements for the product variant.

mass_unit
string

The unit that is used for weight. massUnit is set if and only if weight is set.

Allowed values:
GRAMS
KILOGRAMS
OUNCES
POUNDS
weight
number

Weight, with unit specified by massUnit.

Example:
1.5
distance_unit
string

The unit that is used for length, width and height. distanceUnit is set if and only if at least one of length, width or height is set.

Allowed values:
CENTIMETERS
INCHES
FEET
MILLIMETERS
METERS
YARDS
length
number

Length, with unit specified by distanceUnit.

Example:
10.5
width
number

Width, with unit specified by distanceUnit.

Example:
8
height
number

Height, with unit specified by distanceUnit.

Example:
3.2
Example
1
{
2
  "id": "po_abc123",
3
  "created_at": "2024-01-15T10:30:00Z",
4
  "updated_at": "2024-01-20T14:45:00Z",
5
  "product_id": "string",
6
  "name": "Vanilla Scent",
7
  "sale_state": "FOR_SALE",
8
  "lifecycle_state": "DRAFT",
9
  "idempotence_token": "rrc23negw",
10
  "sku": "vanilla-2019",
11
  "available_quantity": 42,
12
  "backordered_until": "20190208T000915.000Z",
13
  "wholesale_price_cents": 0,
14
  "retail_price_cents": 0,
15
  "tariff_code": "340600",
16
  "images": [
17
    {
18
      "id": "i_adqaiy3htm",
19
      "width": 1000,
20
      "height": 1000,
21
      "sequence": 0,
22
      "url": "https://cdn.faire.com/374cd3041a4c4.png",
23
      "original_url": "https://example.com/original-image.png",
24
      "tags": [
25
        null
26
      ]
27
    }
28
  ],
29
  "options": [
30
    {
31
      "name": "Scent",
32
      "value": "Vanilla"
33
    }
34
  ],
35
  "prices": [
36
    {
37
      "geo_constraint": {},
38
      "wholesale_price": {},
39
      "retail_price": {}
40
    }
41
  ],
42
  "variant_preorder_details": {
43
    "expected_ship_date": "2021-05-21",
44
    "expected_ship_window_end_date": "2021-05-24",
45
    "stop_selling_at": 1619827200000
46
  },
47
  "measurements": {
48
    "mass_unit": "GRAMS",
49
    "weight": 1.5,
50
    "distance_unit": "CENTIMETERS",
51
    "length": 10.5,
52
    "width": 8,
53
    "height": 3.2
54
  },
55
  "gtin": "012345678905",
56
  "orderability_type": "IMMEDIATE",
57
  "case_measurements": {
58
    "mass_unit": "GRAMS",
59
    "weight": 1.5,
60
    "distance_unit": "CENTIMETERS",
61
    "length": 10.5,
62
    "width": 8,
63
    "height": 3.2
64
  }
65
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalProductVariantV2.Price

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalProductVariantV2.Price

Holds alternative pricing.

geo_constraint
object

Geographic constraint indicating where this price applies.

country
string

The ISO alpha-3 country code. The only accepted values are:

"USA" for the United States
"CAN" for Canada
"GBR" for the United Kingdom
"AUS" for Australia
Example:
USA
country_group
string

The only accepted value is "EUROPEAN_UNION"

Example:
EUROPEAN_UNION
wholesale_price
object

The wholesale price for this geographic region.

amount_minor
integer

The amount of money in the smallest unit of the applicable currency. For example, US dollars is in cents.

Example:
4999
currency
string

The type of currency involved in the current payment in ISO 4217 format. For example, US dollars is USD.

Example:
USD
retail_price
object

The recommended retail price for this geographic region.

amount_minor
integer

The amount of money in the smallest unit of the applicable currency. For example, US dollars is in cents.

Example:
4999
currency
string

The type of currency involved in the current payment in ISO 4217 format. For example, US dollars is USD.

Example:
USD
Example
1
{
2
  "geo_constraint": {
3
    "country": "USA",
4
    "country_group": "EUROPEAN_UNION"
5
  },
6
  "wholesale_price": {
7
    "amount_minor": 4999,
8
    "currency": "USD"
9
  },
10
  "retail_price": {
11
    "amount_minor": 4999,
12
    "currency": "USD"
13
  }
14
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalProductVariantV2.Price.PriceGeoConstraint

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalProductVariantV2.Price.PriceGeoConstraint
country
string

The ISO alpha-3 country code. The only accepted values are:

"USA" for the United States
"CAN" for Canada
"GBR" for the United Kingdom
"AUS" for Australia
Example:
USA
country_group
string

The only accepted value is "EUROPEAN_UNION"

Example:
EUROPEAN_UNION
Example
1
{
2
  "country": "USA",
3
  "country_group": "EUROPEAN_UNION"
4
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalProductVariantV2.VariantOrderabilityType

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalProductVariantV2.VariantOrderabilityType
string

Indicates whether a product variant is available for immediate purchase or requires preorder.

Allowed values:
IMMEDIATE
PREORDER
Example
1
IMMEDIATE
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalProductVariantV2.VariantPreorderDetails

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalProductVariantV2.VariantPreorderDetails
expected_ship_date
string

An ISO 8601 extended timestamp representing the start of the shipping window for this preorder Option.

Example:
2021-05-21
expected_ship_window_end_date
string

An ISO 8601 extended timestamp representing the end of the shipping window for this preorder Option.

Example:
2021-05-24
stop_selling_at
integer

The date past which this Option will cease to be sold (gets de-listed).

Example:
1619827200000
Example
1
{
2
  "expected_ship_date": "2021-05-21",
3
  "expected_ship_window_end_date": "2021-05-24",
4
  "stop_selling_at": 1619827200000
5
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalShipmentV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalShipmentV2
id
string

Read-only. A unique identifier of the shipment, beginning with "s_".

Example:
s_bq425ju5vh
created_at
string

Read-only. An ISO 8601 timestamp of when the shipment was created.

Example:
2019-03-15T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 timestamp of when the shipment was last updated.

Example:
2019-03-15T00:09:15.000Z
order_id
string

The ID of the order the shipment is attached to.

Example:
bo_bxdmjbwxid
maker_cost_cents
integer
deprecated

The cost the brand paid to ship the order, in USD cents. Deprecated - use makerCost instead.

carrier
string

The carrier the brand used to ship the order. Currently, the accepted values are CANADA_POST, DHL_ECOMMERCE, DHL_EXPRESS, FEDEX, PUROLATOR, UPS, USPS, POSTNL, CANPAR, INTERLINK_EXPRESS, GSO, ROYAL_MAIL, DPD, DPDUK, PARCELFORCE, AUSTRALIA_POST, EVRI, and LA_POSTE. These values are case insensitive. If another string is entered for this field, Faire will do its best to produce tracking information for that carrier, but may not succeed.

Example:
fedex
tracking_code
string

The tracking code for the shipment, format varies based on the carrier.

Example:
94029300101029282
maker_cost
object

The cost the brand paid to ship the order.

amount_minor
integer

The amount of money in the smallest unit of the applicable currency. For example, US dollars is in cents.

Example:
4999
currency
string

The type of currency involved in the current payment in ISO 4217 format. For example, US dollars is USD.

Example:
USD
shipping_type
string

The type of shipping selected for this shipment (either SHIP_ON_YOUR_OWN or SHIP_WITH_FAIRE).

Allowed values:
SHIP_ON_YOUR_OWN
SHIP_WITH_FAIRE
shipping_label_url
string

A URL to the shipping label for this shipment, if available. This field is read-only.

Example:
https://cdn.faire.com/shipping-labels/label_abc123.pdf
Example
1
{
2
  "id": "s_bq425ju5vh",
3
  "created_at": "2019-03-15T00:09:15.000Z",
4
  "updated_at": "2019-03-15T00:09:15.000Z",
5
  "order_id": "bo_bxdmjbwxid",
6
  "maker_cost_cents": 0,
7
  "carrier": "fedex",
8
  "tracking_code": "94029300101029282",
9
  "maker_cost": {
10
    "amount_minor": 4999,
11
    "currency": "USD"
12
  },
13
  "shipping_type": "SHIP_ON_YOUR_OWN",
14
  "shipping_label_url": "https://cdn.faire.com/shipping-labels/label_abc123.pdf"
15
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalShipmentV2.ExternalShippingType

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalShipmentV2.ExternalShippingType
string

How the shipment is being handled - either the brand ships it themselves or uses Faire's shipping service.

Allowed values:
SHIP_ON_YOUR_OWN
SHIP_WITH_FAIRE
Example
1
SHIP_ON_YOUR_OWN
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalTaxItemV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalTaxItemV2
value
object

The amount of money for this tax.

amount_minor
integer

The amount of money in the smallest unit of the applicable currency. For example, US dollars is in cents.

Example:
4999
currency
string

The type of currency involved in the current payment in ISO 4217 format. For example, US dollars is USD.

Example:
USD
taxable_item_type
string

The item to which this tax applies (e.g., ORDER_ITEM, SHIPPING).

Allowed values:
ORDER_ITEM
SHIPPING
INSIDER_MEMBERSHIP
ORDER_COMMISSION
ADS_CHARGE
tax_type
string

The type of tax being applied (e.g., VAT, GST, HST, PST, IMPORT_VAT, AUSTRALIA_GST, RECARGO).

Allowed values:
CANADIAN_TAX
VAT
VAT_REVERSE_CHARGE
INTRA_COMMUNITY_SUPPLY
GST
HST
PST
ESTIMATED_IMPORT_VAT
IMPORT_VAT
AUSTRALIA_GST
RECARGO
RECARGO_REVERSE_CHARGE
NEW_ZEALAND_GST
SALES_TAX
effect
string

Whether the value of this tax increases or decreases the payout.

Allowed values:
INCREASES_PAYOUT
DEDUCTED_FROM_PAYOUT
Example
1
{
2
  "value": {
3
    "amount_minor": 4999,
4
    "currency": "USD"
5
  },
6
  "taxable_item_type": "ORDER_ITEM",
7
  "tax_type": "CANADIAN_TAX",
8
  "effect": "INCREASES_PAYOUT"
9
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalTaxItemV2.ExternalTaxEffectV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalTaxItemV2.ExternalTaxEffectV2
string

Whether a tax increases or decreases the payout amount.

Allowed values:
INCREASES_PAYOUT
DEDUCTED_FROM_PAYOUT
Example
1
INCREASES_PAYOUT
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/ExternalTaxonomyTypeV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
ExternalTaxonomyTypeV2
id
string

The unique identifier of the taxonomy type.

name
string

The human-readable name of the taxonomy type.

Example
1
{
2
  "id": "string",
3
  "name": "string"
4
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/GetExternalBrandProfileResponseV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
GetExternalBrandProfileResponseV2

Response containing information about the brand associated with the current API session.

brand_id
string

A unique identifier of the brand, beginning with "b_".

Example:
b_60ae65c4
name
string

The name of the brand.

Example:
Jeff's Warm Toques
currency
string

The brand's default currency in ISO 4217 format (e.g., USD, EUR, GBP).

Example:
USD
locale
string

The brand's locale setting.

Example:
en-US
Example
1
{
2
  "brand_id": "b_60ae65c4",
3
  "name": "Jeff's Warm Toques",
4
  "currency": "USD",
5
  "locale": "en-US"
6
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/GetExternalOrdersResponseV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
GetExternalOrdersResponseV2

Response containing a list of orders for the brand, ordered ascending by updated_at by default.

orders
array[object]

A list of orders.

id
string

Read-only. A unique identifier of the order, beginning with "bo_". NOTE: When shown on the Faire website, the "bo_" will be stripped and the order ID will be upper-case. e.g. "bo_bxdmjbwxid" appears as "#BXDMJBWXID" (See display_id).

Example:
bo_bxdmjbwxid
display_id
string

Read-only. The order identifier as displayed on the Faire website, emails, etc.

Example:
BXDMJBWXID
created_at
string

Read-only. An ISO 8601 timestamp of when the order was created.

Example:
2019-03-15T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 timestamp of when the order was last updated.

Example:
2019-03-15T00:10:00.000Z
state
string

The current state of the order.

Allowed values:
NEW
PROCESSING
PRE_TRANSIT
IN_TRANSIT
DELIVERED
CANCELED
BACKORDERED
PENDING_RETAILER_CONFIRMATION
items
array[object]

A list of order items associated with the order.

shipments
array[object]

A list of shipments associated with the order.

address
object

The address the order should be shipped to.

ship_after
string

An ISO 8601 timestamp of the earliest the order should ship.

Example:
2019-03-15T00:09:15.000Z
payout_costs
object

The payout costs associated with the order. NOTE: This may change until the order has been paid out (payment_initiated_at is set), for example if items are removed from the order.

payment_initiated_at
string

An ISO 8601 timestamp of when the brand was paid for this order. Null/absent if the order has not been paid yet.

Example:
2019-03-16T00:10:34.000Z
original_order_id
string

If this order has a parent, for example due to a backorder, this contains the ID of the original order. Null/absent otherwise.

Example:
bo_bg5ude6pmd
retailer_id
string

A unique identifier that represents the retailer who placed the order. See retailers for more information.

Example:
r_c9385ldj
source
string

How this order was initiated (may be MARKETPLACE, FAIRE_DIRECT, TRADESHOW, etc).

Example:
MARKETPLACE
expected_ship_date
string

If specified, an ISO 8601 timestamp of when the order is expected to be shipped.

customer
object
brand_discounts
array[object]

A list of any shop-wide promotions that were applied to this order. Does not include product-specific discounts, which can be found under the discounts field of the relevant order item.

requested_ship_date
string

An ISO 8601 timestamp of when the retailer requested the order to be shipped.

processing_at
string

An ISO 8601 timestamp of when the order moved to PROCESSING state.

is_free_shipping
boolean

True if the order has free shipping of any kind, false otherwise.

Example:
true
free_shipping_reason
string

The reason the order has free shipping, if any.

Allowed values:
INSIDER_FREE_SHIPPING
FAIRE_DIRECT
BRAND_DISCOUNT
FIRST_ORDER
PROMO_CODE
FREE_SHIPPING_THRESHOLD
faire_covered_shipping_cost
object

The amount of the total shipping cost Faire is paying for, if applicable.

estimated_payout_at
string

An ISO 8601 timestamp of when Faire expects to pay the brand for the order. Note that this is not a guarantee of when the order will be paid out.

Example:
2019-03-16T00:00:00.000Z
is_fulfilled_by_faire
boolean

True if the order is fulfilled by Faire, false otherwise.

Example:
false
purchase_order_number
string

Purchase order number entered by retailer (free-text, not validated by Faire).

Example:
12345
notes
string

Brand-facing notes for the order. This field is free-text and may contain special requests or instructions from the retailer.

Example:
Please include a handwritten thank-you note
has_pending_retailer_cancellation_request
boolean

Indicates whether there is a pending cancellation request from the retailer for this order. This is true if the retailer has requested cancellation, the request has not been rejected, and the order is not already canceled.

sales_rep_name
string

The name of the brand sales rep attributed to this order

page
integer

The current page number.

limit
integer

The maximum number of orders per page.

updated_at_min
string

The minimum updated_at timestamp used to filter orders.

sort_by
string

The field used to sort the orders.

Allowed values:
UPDATED_AT
CREATED_AT
cursor
string

A cursor for pagination. Use this value in subsequent requests to get the next page of results.

Example
1
{
2
  "orders": [
3
    {
4
      "id": "bo_bxdmjbwxid",
5
      "display_id": "BXDMJBWXID",
6
      "created_at": "2019-03-15T00:09:15.000Z",
7
      "updated_at": "2019-03-15T00:10:00.000Z",
8
      "state": "NEW",
9
      "items": [
10
        {}
11
      ],
12
      "shipments": [
13
        {}
14
      ],
15
      "address": {},
16
      "ship_after": "2019-03-15T00:09:15.000Z",
17
      "payout_costs": {
18
        "payout_flat_fee": {},
19
        "commission_flat_fee": {},
20
        "payout_fee": {},
21
        "commission": {},
22
        "total_payout": {},
23
        "payout_protection_fee": {},
24
        "damaged_and_missing_items": {},
25
        "net_tax": {},
26
        "shipping_subsidy": {},
27
        "taxes": [],
28
        "subtotal_after_brand_discounts": {},
29
        "total_brand_discounts": {}
30
      },
31
      "payment_initiated_at": "2019-03-16T00:10:34.000Z",
32
      "original_order_id": "bo_bg5ude6pmd",
33
      "retailer_id": "r_c9385ldj",
34
      "source": "MARKETPLACE",
35
      "expected_ship_date": "string",
36
      "customer": {},
37
      "brand_discounts": [
38
        {}
39
      ],
40
      "requested_ship_date": "string",
41
      "processing_at": "string",
42
      "is_free_shipping": true,
43
      "free_shipping_reason": "INSIDER_FREE_SHIPPING",
44
      "faire_covered_shipping_cost": {},
45
      "estimated_payout_at": "2019-03-16T00:00:00.000Z",
46
      "is_fulfilled_by_faire": false,
47
      "purchase_order_number": "12345",
48
      "notes": "Please include a handwritten thank-you note",
49
      "has_pending_retailer_cancellation_request": true,
50
      "sales_rep_name": "string"
51
    }
52
  ],
53
  "page": 0,
54
  "limit": 0,
55
  "updated_at_min": "string",
56
  "sort_by": "UPDATED_AT",
57
  "cursor": "string"
58
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/GetExternalOrdersResponseV2.SortBy

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
GetExternalOrdersResponseV2.SortBy
string
Allowed values:
UPDATED_AT
CREATED_AT
Example
1
UPDATED_AT
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/GetExternalPrepacksResponseV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
GetExternalPrepacksResponseV2

Response containing the list of prepacks (multi-item packages) for the brand.

prepacks
array[object]

The list of prepacks.

id
string

Read-only. A unique identifier of the prepack, beginning with "pc_".

Example:
pc_xyz789
idempotence_token
string

The identifier used for idempotence when this prepack was created.

Example:
prepack_abc123
created_at
string

Read-only. An ISO 8601 timestamp of when the prepack was created.

Example:
2019-03-14T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 timestamp of when the prepack was most recently updated.

Example:
2019-03-15T00:09:15.000Z
name
string

The name of the prepack.

Example:
Assorted Sizes Pack
description
string

A description of the prepack. The description is determined by the quantities and sizes of prepack items.

Example:
Pack includes 2 Small, 3 Medium, 2 Large
items
array[object]

A list of prepack items that belong to this prepack.

Example
1
{
2
  "prepacks": [
3
    {
4
      "id": "pc_xyz789",
5
      "idempotence_token": "prepack_abc123",
6
      "created_at": "2019-03-14T00:09:15.000Z",
7
      "updated_at": "2019-03-15T00:09:15.000Z",
8
      "name": "Assorted Sizes Pack",
9
      "description": "Pack includes 2 Small, 3 Medium, 2 Large",
10
      "items": [
11
        {}
12
      ]
13
    }
14
  ]
15
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/GetExternalProductReviewsResponseV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
GetExternalProductReviewsResponseV2

Response containing product reviews for a brand.

product_reviews_with_details
array[object]
product_review
object
retailer_id
string
product_info
object
limit
integer

The number of items per page.

cursor
string

Cursor for cursor-based pagination. Use this for efficient pagination of large result sets. Null when no more pages available.

Example
1
{
2
  "product_reviews_with_details": [
3
    {
4
      "product_review": {
5
        "images": [],
6
        "reply": {}
7
      },
8
      "retailer_id": "string",
9
      "product_info": {}
10
    }
11
  ],
12
  "limit": 0,
13
  "cursor": "string"
14
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/GetExternalProductsResponseV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
GetExternalProductsResponseV2

Response containing a paginated list of products for the brand.

products
array[object]

A list of products.

id
string

Read-only. The unique identifier of the product, beginning with "p_".

Example:
p_123
created_at
string

Read-only. An ISO 8601 extended timestamp of when the product was created.

Example:
2019-03-14T00:09:15.000Z
updated_at
string

Read-only. An ISO 8601 extended timestamp of when the product was last updated.

Example:
2019-03-15T00:09:15.000Z
brand_id
string

Read-only. A unique identifier of the brand that owns the product, beginning with "b_".

Example:
b_abc
name
string

The name of the product.

Example:
Faire's fantastic candle
description
string

A description of the product, at most 65,535 characters.

Example:
Glad you decided to read our description! We have significantly more characters to describe to you just how good our candles smell.
short_description
string

A short description of the product, at most 255 characters.

Example:
Our candles smell fantastic. Want to know how good? Read our description!
sale_state
string

Read-only. The current sellability of the product on Faire.

Allowed values:
FOR_SALE
SALES_PAUSED
lifecycle_state
string

Read-only. The current stage in the lifecycle of a product on Faire.

Allowed values:
DRAFT
PUBLISHED
UNPUBLISHED
DELETED
variants
array[object]

A list of product variants that belong to this product.

idempotence_token
string

TODO (bad docs): The identifier used when this product was created.

Example:
4aytry2ust
unit_multiplier
integer

Also known as case size or case quantity. This is the unit size that this product ships in. The product must be purchased in increments of this number.

Example:
2
minimum_order_quantity
integer

The minimum number of units required to purchase this product. Must be a multiple of the unit_multiplier.

Example:
8
per_style_minimum_order_quantity
integer

The minimum number of units of this product that can be ordered for the same "style". "Style" is defined as the set of variation values excluding the value for the "Size" variation. A product without a "Size" variation cannot use perStyleMinimumOrderQuantity.Show all...

Example:
0
allow_sales_when_out_of_stock
boolean

determines if the state of the options can be SALES_PAUSED for stock reasons

Example:
false
images
array[object]

The list of [images] associated with the product.

variant_option_sets
array[object]

A list of the different available options (attributes) used to compose variants. Products can only have the available option names defined on creation. If you want to redefine a product to have an additional option dimension, you must delete this product and create a new one. Option values are ordered (ex. Small, Medium, Large) and affect how they are displayed.Show all...

taxonomy_type
object

The [taxonomy type] of this product.

preorderable
boolean

True when the product can be preordered. If this field is true, preorder_details will be non-null.

preorder_details
object

An object containing all the details for a preorderable product. null if preorderable is false.

product_attributes
array[object]

Object containing list of taxonomy attributes for the product *

made_in_country
string

Country of origin for the product *

page
integer

The current page number.

limit
integer

The maximum number of products per page.

updated_at_min
string

The minimum updated_at timestamp used to filter products.

cursor
string

A cursor for pagination. Use this value in subsequent requests to get the next page of results.

Example
1
{
2
  "products": [
3
    {
4
      "id": "p_123",
5
      "created_at": "2019-03-14T00:09:15.000Z",
6
      "updated_at": "2019-03-15T00:09:15.000Z",
7
      "brand_id": "b_abc",
8
      "name": "Faire's fantastic candle",
9
      "description": "Glad you decided to read our description! We have significantly more characters to describe to you just how good our candles smell.",
10
      "short_description": "Our candles smell fantastic. Want to know how good? Read our description!",
11
      "sale_state": "FOR_SALE",
12
      "lifecycle_state": "DRAFT",
13
      "variants": [
14
        {}
15
      ],
16
      "idempotence_token": "4aytry2ust",
17
      "unit_multiplier": 2,
18
      "minimum_order_quantity": 8,
19
      "per_style_minimum_order_quantity": 0,
20
      "allow_sales_when_out_of_stock": false,
21
      "images": [
22
        {}
23
      ],
24
      "variant_option_sets": [
25
        {}
26
      ],
27
      "taxonomy_type": {},
28
      "preorderable": true,
29
      "preorder_details": {},
30
      "product_attributes": [
31
        {}
32
      ],
33
      "made_in_country": "string"
34
    }
35
  ],
36
  "page": 0,
37
  "limit": 0,
38
  "updated_at_min": "string",
39
  "cursor": "string"
40
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/GetExternalRetailerProfileResponseV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
GetExternalRetailerProfileResponseV2

Response containing information about a retailer who placed an order with the brand.

retailer_id
string

A unique identifier for the retailer.

Example:
r_c9385ldj
name
string

The name of the retailer's business.

Example:
Faire Wholesale, Inc
is_insider
boolean

Indicates whether this retailer currently has an active Faire Insider membership. This field is true if the retailer has an active isInsider membership (TRIALING or ACTIVE status), and false otherwise (no membership, or CANCELLED/UNPAID/PAUSED status).

Example:
true
Example
1
{
2
  "retailer_id": "r_c9385ldj",
3
  "name": "Faire Wholesale, Inc",
4
  "is_insider": true
5
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/GetExternalTaxonomyTypesResponseV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
GetExternalTaxonomyTypesResponseV2

Response containing the list of available product taxonomy types (categories) on Faire.

taxonomy_types
array[object]

A list of available taxonomy types.

id
string

The unique identifier of the taxonomy type.

name
string

The human-readable name of the taxonomy type.

Example
1
{
2
  "taxonomy_types": [
3
    {
4
      "id": "string",
5
      "name": "string"
6
    }
7
  ]
8
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/GetInventoryResponseV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
GetInventoryResponseV2

Response containing inventory levels for product variants, mapped by SKU or variant ID.

inventories
dictionary[string, object]
on_hand_quantity
object

The number of units physically on hand with the brand. This can be untracked or negative.

committed_quantity
object

The number of units allocated for unfulfilled orders. This must be a non-negative quantity.

available_quantity
object

The number of units available for purchase. This can be untracked or negative. Defined as (onHandQuantity - committedQuantity)

Example
1
{
2
  "inventories": {
3
    "property1": {
4
      "on_hand_quantity": {},
5
      "committed_quantity": {},
6
      "available_quantity": {}
7
    },
8
    "property2": {
9
      "on_hand_quantity": {},
10
      "committed_quantity": {},
11
      "available_quantity": {}
12
    }
13
  }
14
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/MoveOrderToProcessingRequestV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
MoveOrderToProcessingRequestV2

Request to move an order from NEW state to PROCESSING state, indicating the brand has begun fulfilling it.

expected_ship_date
string

Optional. If specified, an ISO 8601 timestamp of when the order is expected to be shipped.

Example
1
{
2
  "expected_ship_date": "string"
3
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/PatchVariantOptionSetsRequestV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
PatchVariantOptionSetsRequestV2
variant_option_sets
array[object]
name
string

The name of the option (e.g., "Size", "Color").

Example:
Scent
values
array[string]

The available values for this option (e.g., ["Small", "Medium", "Large"]).

Example
1
{
2
  "variant_option_sets": [
3
    {
4
      "name": "Scent",
5
      "values": [
6
        null
7
      ]
8
    }
9
  ]
10
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/PatchVariantOptionSetsResponseV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
PatchVariantOptionSetsResponseV2
variant_option_sets
array[object]
name
string

The name of the option (e.g., "Size", "Color").

Example:
Scent
values
array[string]

The available values for this option (e.g., ["Small", "Medium", "Large"]).

Example
1
{
2
  "variant_option_sets": [
3
    {
4
      "name": "Scent",
5
      "values": [
6
        null
7
      ]
8
    }
9
  ]
10
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/UpdateInventoryLevelsRequestV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
UpdateInventoryLevelsRequestV2
inventories
array[object]
sku
string
current_quantity
integer
discontinued
boolean
backordered_until
string
product_variant_id
string
Example
1
{
2
  "inventories": [
3
    {
4
      "sku": "string",
5
      "current_quantity": 0,
6
      "discontinued": true,
7
      "backordered_until": "string",
8
      "product_variant_id": "string"
9
    }
10
  ]
11
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/UpdateInventoryLevelsRequestV2.ProductVariantInventory

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
UpdateInventoryLevelsRequestV2.ProductVariantInventory
sku
string
current_quantity
integer
discontinued
boolean
backordered_until
string
product_variant_id
string
Example
1
{
2
  "sku": "string",
3
  "current_quantity": 0,
4
  "discontinued": true,
5
  "backordered_until": "string",
6
  "product_variant_id": "string"
7
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/UpdateInventoryLevelsResponseV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
UpdateInventoryLevelsResponseV2
variants
array[object]
id
string

Read-only. The unique identifier of the variant, beginning with "po_".

Example:
po_abc123
created_at
string

Read-only. An ISO 8601 extended timestamp of when the variant was created.

Example:
2024-01-15T10:30:00Z
updated_at
string

Read-only. An ISO 8601 extended timestamp of when the variant was last updated.

Example:
2024-01-20T14:45:00Z
product_id
string

Read-only. The unique identifier of the product the variant belongs to, beginning with "p_".

name
string

The name of the variant.

Example:
Vanilla Scent
sale_state
string

Read-only. The current sellability of the variant on Faire.

Allowed values:
FOR_SALE
SALES_PAUSED
lifecycle_state
string

Read-only. The current stage in the lifecycle of a variant on Faire.

Allowed values:
DRAFT
PUBLISHED
UNPUBLISHED
DELETED
idempotence_token
string

TODO (bad docs): The identifier used when this variant was created.

Example:
rrc23negw
sku
string

An identifier that should be unique amongst variants. It is up to the client to keep SKUs unique. SKUs are case-sensitive.

Example:
vanilla-2019
available_quantity
integer

If set, the number of units available for sale. If not set in the response, the brand has not set their inventory levels in Faire.

Example:
42
backordered_until
string

If set, Faire will not allow the product option to be FOR_SALE until this date.

Example:
20190208T000915.000Z
wholesale_price_cents
integer
deprecated

The current wholesale price of a single unit of this variant in cents (US dollars). Deprecated - use prices instead.

retail_price_cents
integer
deprecated

The current recommended retailer price of a single unit of this option in cents (US dollars). Deprecated - use prices instead.

tariff_code
string

The tariff code (HS code) for this product variant.

Example:
340600
images
array[object]

The list of images associated with the variant.

options
array[object]

A set of options (attributes) that define this variant. For example, if the variant is a large red shirt, the options might include Color:Red and Size:Large. The options must be valid name/value pairs from the product's option_definitions.

prices
array[object]

All the available prices with currency for this variant, by geographic region.

variant_preorder_details
object

An object containing all the details for a preorderable variant. null if orderabilityType is IMMEDIATE.

measurements
object

Measurements for the product variant.

gtin
string

A Global Trade Item Number (GTIN) for the product variant. These are standardized codes issues by GS1 and include barcodes like UPC, ISBN, and EAN. GTINs must consist of only numbers, be 8, 12, 13, or 14 digits long, and have a valid check digit.

Example:
012345678905
orderability_type
string

Indicates whether the variant is available for sale immediately or if it is preorderable.

Allowed values:
IMMEDIATE
PREORDER
case_measurements
object

Case measurements for the product variant.

Example
1
{
2
  "variants": [
3
    {
4
      "id": "po_abc123",
5
      "created_at": "2024-01-15T10:30:00Z",
6
      "updated_at": "2024-01-20T14:45:00Z",
7
      "product_id": "string",
8
      "name": "Vanilla Scent",
9
      "sale_state": "FOR_SALE",
10
      "lifecycle_state": "DRAFT",
11
      "idempotence_token": "rrc23negw",
12
      "sku": "vanilla-2019",
13
      "available_quantity": 42,
14
      "backordered_until": "20190208T000915.000Z",
15
      "wholesale_price_cents": 0,
16
      "retail_price_cents": 0,
17
      "tariff_code": "340600",
18
      "images": [
19
        {}
20
      ],
21
      "options": [
22
        {}
23
      ],
24
      "prices": [
25
        {}
26
      ],
27
      "variant_preorder_details": {},
28
      "measurements": {},
29
      "gtin": "012345678905",
30
      "orderability_type": "IMMEDIATE",
31
      "case_measurements": {}
32
    }
33
  ]
34
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/UpdateOnHandInventoryRequestV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
UpdateOnHandInventoryRequestV2
inventories
array[object]
sku
string
product_variant_id
string
on_hand_quantity
integer
Example
1
{
2
  "inventories": [
3
    {
4
      "sku": "string",
5
      "product_variant_id": "string",
6
      "on_hand_quantity": 0
7
    }
8
  ]
9
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/UpdateOnHandInventoryRequestV2.ProductVariantInventory

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
UpdateOnHandInventoryRequestV2.ProductVariantInventory
sku
string
product_variant_id
string
on_hand_quantity
integer
Example
1
{
2
  "sku": "string",
3
  "product_variant_id": "string",
4
  "on_hand_quantity": 0
5
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/UpdateOnHandInventoryResponseV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
UpdateOnHandInventoryResponseV2
inventories
dictionary[string, object]
on_hand_quantity
object

The number of units physically on hand with the brand. This can be untracked or negative.

committed_quantity
object

The number of units allocated for unfulfilled orders. This must be a non-negative quantity.

available_quantity
object

The number of units available for purchase. This can be untracked or negative. Defined as (onHandQuantity - committedQuantity)

Example
1
{
2
  "inventories": {
3
    "property1": {
4
      "on_hand_quantity": {},
5
      "committed_quantity": {},
6
      "available_quantity": {}
7
    },
8
    "property2": {
9
      "on_hand_quantity": {},
10
      "committed_quantity": {},
11
      "available_quantity": {}
12
    }
13
  }
14
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/UpdateProductPricesByProductVariantIdsRequestV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
UpdateProductPricesByProductVariantIdsRequestV2

Request to update product prices in batch by product variant IDs.

prices
array[object]

List of product variant price updates by product variant ID.

product_variant_id
string

The product variant ID to update.

prices
array[object]

The new prices for this variant.

Example
1
{
2
  "prices": [
3
    {
4
      "product_variant_id": "string",
5
      "prices": [
6
        {}
7
      ]
8
    }
9
  ]
10
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
product_variant_id
string

The product variant ID to update.

prices
array[object]

The new prices for this variant.

geo_constraint
object

Geographic constraint indicating where this price applies.

wholesale_price
object

The wholesale price for this geographic region.

retail_price
object

The recommended retail price for this geographic region.

Example
1
{
2
  "product_variant_id": "string",
3
  "prices": [
4
    {
5
      "geo_constraint": {},
6
      "wholesale_price": {},
7
      "retail_price": {}
8
    }
9
  ]
10
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/UpdateProductPricesBySkusRequestV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
UpdateProductPricesBySkusRequestV2

Request to update product prices in batch by SKUs.

prices
array[object]

List of product variant price updates by SKU.

sku
string

The SKU to update.

prices
array[object]

The new prices for this variant.

Example
1
{
2
  "prices": [
3
    {
4
      "sku": "string",
5
      "prices": [
6
        {}
7
      ]
8
    }
9
  ]
10
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
sku
string

The SKU to update.

prices
array[object]

The new prices for this variant.

geo_constraint
object

Geographic constraint indicating where this price applies.

wholesale_price
object

The wholesale price for this geographic region.

retail_price
object

The recommended retail price for this geographic region.

Example
1
{
2
  "sku": "string",
3
  "prices": [
4
    {
5
      "geo_constraint": {},
6
      "wholesale_price": {},
7
      "retail_price": {}
8
    }
9
  ]
10
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/UpdateProductPricesResponseV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
UpdateProductPricesResponseV2

Response from updating product prices in batch.

results
dictionary[string, object]
prices
array[object]

The updated prices for this identifier.

Example
1
{
2
  "results": {
3
    "property1": {
4
      "prices": [
5
        {}
6
      ]
7
    },
8
    "property2": {
9
      "prices": [
10
        {}
11
      ]
12
    }
13
  }
14
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/UpdateProductPricesResponseV2.PriceUpdateResult

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
UpdateProductPricesResponseV2.PriceUpdateResult
prices
array[object]

The updated prices for this identifier.

geo_constraint
object

Geographic constraint indicating where this price applies.

wholesale_price
object

The wholesale price for this geographic region.

retail_price
object

The recommended retail price for this geographic region.

Example
1
{
2
  "prices": [
3
    {
4
      "geo_constraint": {},
5
      "wholesale_price": {},
6
      "retail_price": {}
7
    }
8
  ]
9
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/UploadImageRequestV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
UploadImageRequestV2

Request to upload an image by providing a base64-encoded image attachment.

attachment
string

The image file, encoded in Base64.

Example
1
{
2
  "attachment": "string"
3
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/UploadImageResponseV2

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
UploadImageResponseV2

Response containing the URL of the uploaded image hosted on Faire's CDN.

url
string

The URL of the uploaded image hosted on Faire's CDN.

Example
1
{
2
  "url": "string"
3
}
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/indigofair.data.TaxItem.TaxableItemType

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
indigofair.data.TaxItem.TaxableItemType
string
Allowed values:
ORDER_ITEM
SHIPPING
INSIDER_MEMBERSHIP
ORDER_COMMISSION
ADS_CHARGE
Example
1
ORDER_ITEM
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies


---

### #/schemas/indigofair.data.TaxItem.Type

API Docs
Sign In
Create Account
API assistant

Get AI-powered guidance for Faire's APIs.

Faire External API
Overview
ENDPOINTS
Brands
Inventory
Orders
GET /orders
GET
GET /orders/{order_id}
GET
PUT /orders/{order_id}/cancel
PUT
POST /orders/{order_id}/items/availability
POST
GET /orders/{order_id}/packing-slip-pdf
GET
PUT /orders/{order_id}/processing
PUT
POST /orders/{order_id}/shipments
POST
Prepacks
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
Product Variants
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Products
PATCH /product-prices/by-product-variant-ids
PATCH
PATCH /product-prices/by-skus
PATCH
GET /products
GET
POST /products
POST
GET /products/reviews
GET
GET /products/types
GET
POST /products/upload-image
POST
PATCH /products/variants/inventory-levels-by-product-variant-ids
PATCH
PATCH /products/variants/inventory-levels-by-skus
PATCH
GET /products/{product_id}
GET
PATCH /products/{product_id}
PATCH
DELETE /products/{product_id}
DELETE
DELETE /products/{product_id}/images/{image_id}
DELETE
GET /products/{product_id}/prepacks
GET
POST /products/{product_id}/prepacks
POST
POST /products/{product_id}/prepacks/batch
POST
GET /products/{product_id}/prepacks/{prepack_id}
GET
DELETE /products/{product_id}/prepacks/{prepack_id}
DELETE
PATCH /products/{product_id}/variant-option-sets
PATCH
POST /products/{product_id}/variants
POST
PATCH /products/{product_id}/variants/{variant_id}
PATCH
DELETE /products/{product_id}/variants/{variant_id}
DELETE
DELETE /products/{product_id}/variants/{variant_id}/images/{image_id}
DELETE
Retailers
SCHEMAS
GetExternalBrandProfileResponseV2
ExternalOrderV2
ExternalOrderV2.State
ExternalOrderItemV2
ExternalOrderItemV2.Customization
ExternalMoneyV2
ExternalDiscountV2
ExternalDiscountV2.DiscountType
ExternalOrderItemV2.State
ExternalShipmentV2
ExternalShipmentV2.ExternalShippingType
ExternalAddressV2
ExternalAddressV2.AddressType
ExternalPayoutCostsV2
ExternalTaxItemV2
indigofair.data.TaxItem.TaxableItemType
indigofair.data.TaxItem.Type
ExternalTaxItemV2.ExternalTaxEffectV2
ExternalOrderV2.Customer
ExternalOrderV2.ExternalFreeShippingReason
GetExternalOrdersResponseV2.SortBy
GetExternalOrdersResponseV2
ExternalOrderV2.CancelReason
ExternalCancelBrandOrderRequestV2
EditItemsAvailabilityRequestV2.ItemAvailability
EditItemsAvailabilityRequestV2
MoveOrderToProcessingRequestV2
AddShipmentsRequestV2
ExternalProductVariantInventory
ExternalInventoryQuantity
ExternalInventoryQuantity.Type
GetInventoryResponseV2
UpdateOnHandInventoryRequestV2.ProductVariantInventory
UpdateOnHandInventoryRequestV2
UpdateOnHandInventoryResponseV2
UpdateProductPricesByProductVariantIdsRequestV2.ProductVariantPriceByVariantId
ExternalProductVariantV2.Price
ExternalProductVariantV2.Price.PriceGeoConstraint
UpdateProductPricesByProductVariantIdsRequestV2
UpdateProductPricesResponseV2.PriceUpdateResult
UpdateProductPricesResponseV2
UpdateProductPricesBySkusRequestV2.ProductVariantPriceBySku
UpdateProductPricesBySkusRequestV2
ExternalProductV2
ExternalProductV2.SaleState
ExternalProductV2.LifecycleState
ExternalProductVariantV2
ExternalImageV2
ExternalProductVariantOptionV2
ExternalProductVariantV2.VariantPreorderDetails
ExternalMeasurementsV2
ExternalMassUnitV2
ExternalDistanceUnitV2
ExternalProductVariantV2.VariantOrderabilityType
ExternalProductVariantOptionDefinitionV2
ExternalTaxonomyTypeV2
ExternalProductV2.PreorderDetails
ExternalProductTaxonomyAttributeV2
GetExternalProductsResponseV2
ExternalProductReviewWithDetailsV2
ExternalProductReviewV2
ExternalProductReviewReplyV2
ExternalProductInfoV2
GetExternalProductReviewsResponseV2
GetExternalTaxonomyTypesResponseV2
UploadImageRequestV2
UploadImageResponseV2
UpdateInventoryLevelsRequestV2.ProductVariantInventory
UpdateInventoryLevelsRequestV2
UpdateInventoryLevelsResponseV2
ExternalPrepackV2
ExternalPrepackItemV2
GetExternalPrepacksResponseV2
CreateExternalPrepacksRequestV2
CreateExternalPrepacksResponseV2
PatchVariantOptionSetsRequestV2
PatchVariantOptionSetsResponseV2
GetExternalRetailerProfileResponseV2
powered by Stoplight
indigofair.data.TaxItem.Type
string
Allowed values:
CANADIAN_TAX
VAT
VAT_REVERSE_CHARGE
INTRA_COMMUNITY_SUPPLY
GST
HST
PST
ESTIMATED_IMPORT_VAT
IMPORT_VAT
AUSTRALIA_GST
RECARGO
RECARGO_REVERSE_CHARGE
NEW_ZEALAND_GST
SALES_TAX
Example
1
CANADIAN_TAX
The online wholesale marketplace connecting local retailers with emerging and established brands worldwide.
Company
About Us
Newsroom
Careers
Affiliates
Blog
Connect
Instagram
Facebook
X

©2026 Faire Wholesale, Inc.

|

Terms of Service

|

Privacy Policy

|

Cookie Policy

|

IP Policy

By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. You can choose "Cookie Settings" for more information and to customize your settings and disable all or some non-essential cookies.
Cookies Settings Reject All Accept All Cookies