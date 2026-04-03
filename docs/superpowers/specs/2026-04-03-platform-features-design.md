# Design Spec — Fonctionnalités plateforme B2B complète

**Date** : 2026-04-03  
**Approche** : Fondation commune d'abord, puis features (approche B)  
**Ordre d'implémentation** : Stock → Messagerie → Chat → SAV → Promotions → Stats produit → Dashboard client

---

## 1. Gestion de stock avancée

### Modèle de données

```prisma
model StockMovement {
  id             String       @id @default(cuid())
  productColorId String
  productColor   ProductColor @relation(fields: [productColorId], references: [id], onDelete: Cascade)
  sizeId         String?
  size           Size?        @relation(fields: [sizeId], references: [id])
  quantity       Int          // positif = entrée, négatif = sortie
  type           StockMovementType
  reason         String?      // note libre admin
  orderId        String?
  order          Order?       @relation(fields: [orderId], references: [id])
  createdById    String?
  createdBy      User?        @relation(fields: [createdById], references: [id])
  createdAt      DateTime     @default(now())
}

enum StockMovementType {
  MANUAL_IN
  MANUAL_OUT
  ORDER
  CANCEL
  RETURN
  IMPORT
}
```

**Champs ajoutés :**
- `VariantSize.stock` : Int, default 0 (stock UNIT)
- `ProductColor.stock` : Int, default 0 (stock PACK, pas de tailles)
- `Product.lowStockThreshold` : Int?, nullable (si null → utilise le seuil global de SiteConfig)
- `SiteConfig` : clé `default_low_stock_threshold`, default 5

### Comportement

- **ORDER** : décrément quand commande passe en PROCESSING
- **CANCEL** : réincrément si commande annulée
- **RETURN** : réincrément quand retour SAV reçu
- **MANUAL_IN / MANUAL_OUT** : ajustement admin avec raison obligatoire
- **IMPORT** : quantités initiales via import produit

### UI Admin — Page produit

- Champ "Stock" par taille (UNIT) ou par couleur (PACK) dans l'éditeur de variantes
- Bouton "Ajuster le stock" → modal : quantité (+/-), raison
- Historique des mouvements (tableau : date, type, qté, raison, commande liée)
- Badge "Stock bas" dans la liste produits si stock <= seuil
- Compteur "Produits en stock bas" sur le dashboard admin

### UI Client

- Badge "Rupture de stock" sur variantes à stock 0
- Bouton "Ajouter au panier" désactivé si stock insuffisant
- Validation serveur au checkout : erreur claire si stock insuffisant entre-temps

### Seuil configurable

- Par produit : `lowStockThreshold` sur Product
- Global : clé SiteConfig `default_low_stock_threshold`
- Le seuil produit prime sur le global

---

## 2. Infrastructure messagerie + emails

### Modèle de données

```prisma
model Conversation {
  id        String             @id @default(cuid())
  type      ConversationType
  subject   String?
  status    ConversationStatus @default(OPEN)
  userId    String
  user      User               @relation(fields: [userId], references: [id])
  claimId   String?            @unique
  claim     Claim?             @relation(fields: [claimId], references: [id])
  messages  Message[]
  createdAt DateTime           @default(now())
  updatedAt DateTime           @updatedAt
}

model Message {
  id             String              @id @default(cuid())
  conversationId String
  conversation   Conversation        @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  senderId       String
  sender         User                @relation(fields: [senderId], references: [id])
  senderRole     UserRole            // ADMIN | CLIENT
  content        String              @db.Text
  source         MessageSource       @default(APP)
  readAt         DateTime?
  attachments    MessageAttachment[]
  createdAt      DateTime            @default(now())
}

model MessageAttachment {
  id        String  @id @default(cuid())
  messageId String
  message   Message @relation(fields: [messageId], references: [id], onDelete: Cascade)
  fileName  String
  filePath  String  // R2 path
  fileSize  Int
  mimeType  String
  createdAt DateTime @default(now())
}

enum ConversationType {
  SUPPORT
  CLAIM
}

enum ConversationStatus {
  OPEN
  CLOSED
}

enum MessageSource {
  APP
  EMAIL
}
```

### Email bidirectionnel

**Sortant (App → Email) :**
- Client envoie message → email admin avec contenu + lien conversation
- Admin répond dans l'app → email client
- Sujet email contient `[CONV-XXXX]` (ID court)

**Entrant (Email → App) :**
- Endpoint `/api/messages/inbound` 
- Polling IMAP périodique (cron 2-3 min) sur la boîte Gmail
- Parse le sujet pour `[CONV-XXXX]`, retrouve la conversation
- Crée un `Message` avec `source: EMAIL`

### Templates email

Réutilisation de `lib/gmail.ts` avec templates HTML :
- `new-message` : "Nouveau message de [Client/Admin]"
- `new-claim` : "Nouvelle réclamation de [Client]"
- `claim-status-update` : "Votre réclamation a été [acceptée/refusée]"

### Composant partagé

`<ConversationThread />` — utilisé dans chat ET SAV :
- Bulles type chat (gauche = interlocuteur, droite = moi)
- Zone de saisie + upload pièces jointes (R2)
- Indicateur lu/non-lu
- Badge `via email` sur messages source EMAIL
- Responsive : pleine largeur sur mobile

---

## 3. Chat client ↔ admin

### Côté client

- Page `/espace-pro/messages`
- Liste conversations : sujet, dernier message (aperçu), date, statut, badge non-lu
- Bouton "Nouveau message" → modal (sujet + message + pièces jointes)
- Vue conversation avec `<ConversationThread />`
- Badge non-lu dans la sidebar client sur "Messages"

### Côté admin

- Page `/admin/messages`
- Liste conversations SUPPORT, triées par dernière activité
- Filtres : Toutes / Non lues / Ouvertes / Fermées
- Recherche par client (nom, entreprise)
- Vue conversation + infos client en sidebar (entreprise, email, dernière commande)
- Bouton "Fermer la conversation"
- Compteur "Messages non lus" sur dashboard + sidebar admin
- Dark mode : composants adaptés aux variables CSS

### Flux email

- Client → message → email admin "Nouveau message de [Entreprise] — [Sujet]" + lien
- Admin répond (app) → email client
- Admin répond (email reply) → polling IMAP → message créé dans l'app

---

## 4. SAV / Retours

### Modèle de données

```prisma
model Claim {
  id             String          @id @default(cuid())
  reference      String          @unique // SAV-YYYY-XXXXXX
  type           ClaimType
  status         ClaimStatus     @default(OPEN)
  userId         String
  user           User            @relation(fields: [userId], references: [id])
  orderId        String?
  order          Order?          @relation(fields: [orderId], references: [id])
  description    String          @db.Text
  adminNote      String?         @db.Text
  resolution     ClaimResolution?
  refundAmount   Decimal?        @db.Decimal(10, 2)
  creditAmount   Decimal?        @db.Decimal(10, 2)
  conversation   Conversation?
  items          ClaimItem[]
  images         ClaimImage[]
  returnInfo     ClaimReturn?
  reshipInfo     ClaimReship?
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
}

model ClaimItem {
  id           String     @id @default(cuid())
  claimId      String
  claim        Claim      @relation(fields: [claimId], references: [id], onDelete: Cascade)
  orderItemId  String?
  orderItem    OrderItem? @relation(fields: [orderItemId], references: [id])
  quantity     Int
  reason       ClaimItemReason
  reasonDetail String?
}

model ClaimImage {
  id        String   @id @default(cuid())
  claimId   String
  claim     Claim    @relation(fields: [claimId], references: [id], onDelete: Cascade)
  imagePath String   // R2
  createdAt DateTime @default(now())
}

model ClaimReturn {
  id             String            @id @default(cuid())
  claimId        String            @unique
  claim          Claim             @relation(fields: [claimId], references: [id])
  method         ShippingMethod
  status         ReturnStatus      @default(PENDING)
  trackingNumber String?
  shippingLabel  String?           // PDF R2 path
  adminNote      String?
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt
}

model ClaimReship {
  id             String            @id @default(cuid())
  claimId        String            @unique
  claim          Claim             @relation(fields: [claimId], references: [id])
  method         ShippingMethod
  status         ReshipStatus      @default(PENDING)
  trackingNumber String?
  shippingLabel  String?
  adminNote      String?
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt
}

model Credit {
  id              String        @id @default(cuid())
  userId          String
  user            User          @relation(fields: [userId], references: [id])
  amount          Decimal       @db.Decimal(10, 2)
  remainingAmount Decimal       @db.Decimal(10, 2)
  claimId         String?
  claim           Claim?        @relation(fields: [claimId], references: [id])
  expiresAt       DateTime?
  usages          CreditUsage[]
  createdAt       DateTime      @default(now())
}

model CreditUsage {
  id        String   @id @default(cuid())
  creditId  String
  credit    Credit   @relation(fields: [creditId], references: [id])
  orderId   String
  order     Order    @relation(fields: [orderId], references: [id])
  amount    Decimal  @db.Decimal(10, 2)
  createdAt DateTime @default(now())
}

enum ClaimType {
  ORDER_CLAIM
  GENERAL
}

enum ClaimStatus {
  OPEN
  IN_REVIEW
  ACCEPTED
  REJECTED
  RETURN_PENDING
  RETURN_SHIPPED
  RETURN_RECEIVED
  RESOLUTION_PENDING
  RESOLVED
  CLOSED
}

enum ClaimResolution {
  REFUND
  CREDIT
  RESHIP
  NONE
}

enum ClaimItemReason {
  DEFECTIVE
  WRONG_ITEM
  MISSING
  DAMAGED
  OTHER
}

enum ShippingMethod {
  EASY_EXPRESS
  CLIENT_SELF
  OTHER
}

enum ReturnStatus {
  PENDING
  LABEL_GENERATED
  SHIPPED
  RECEIVED
}

enum ReshipStatus {
  PENDING
  SHIPPED
  DELIVERED
}
```

### Workflow

```
OPEN → IN_REVIEW → ACCEPTED / REJECTED
  Si ACCEPTED :
    → Admin choisit résolution (REFUND / CREDIT / RESHIP)
    → Si retour requis : RETURN_PENDING → RETURN_SHIPPED → RETURN_RECEIVED
    → Puis résolution appliquée → RESOLVED → CLOSED
  Si REJECTED :
    → CLOSED (notification client)
```

### Côté client

- Bouton "Signaler un problème" sur chaque commande (page détail)
- Page `/espace-pro/reclamations` — liste réclamations + statut
- Formulaire création :
  - Depuis commande : sélection articles + quantité + raison (dropdown) + détail + photos (max 5)
  - Libre : sujet + description + photos
- Vue détail : timeline statut + conversation `<ConversationThread />`
- Si retour Easy Express : bouton "Télécharger le bordereau"
- Bouton "Confirmer l'envoi du retour"
- Section "Mes avoirs" dans l'espace pro

### Côté admin

- Page `/admin/reclamations`
- Liste avec filtres (statut, type, date, client) + recherche
- Badge compteur dashboard + sidebar
- Vue détail :
  - Infos client + commande liée + photos du problème
  - Articles réclamés (quantité, raison)
  - Panel d'actions contextuel selon statut :
    - Accepter / Rejeter (avec message)
    - Choisir résolution
    - Demander retour (Easy Express ou client)
    - Confirmer réception retour
    - Lancer réexpédition (Easy Express ou autre + tracking)
  - Conversation intégrée
  - Note interne (non visible client)
  - Dark mode compatible

### Avoir (Credit)

- Appliqué automatiquement au checkout si solde disponible
- Avoir appliqué APRÈS les promotions
- Visible dans espace pro client
- Historique d'utilisation (commande, montant, date)

---

## 5. Promotions / Codes promo

### Modèle de données

```prisma
model Promotion {
  id              String          @id @default(cuid())
  name            String
  type            PromotionType
  code            String?         @unique
  discountType    DiscountType
  discountValue   Decimal         @db.Decimal(10, 2)
  minOrderAmount  Decimal?        @db.Decimal(10, 2)
  maxUses         Int?
  maxUsesPerUser  Int?
  firstOrderOnly  Boolean         @default(false)
  appliesToAll    Boolean         @default(true)
  startsAt        DateTime
  endsAt          DateTime?
  isActive        Boolean         @default(true)
  currentUses     Int             @default(0)
  categories      Category[]      @relation("PromotionCategories")
  collections     Collection[]    @relation("PromotionCollections")
  products        Product[]       @relation("PromotionProducts")
  usages          PromotionUsage[]
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
}

model PromotionUsage {
  id              String    @id @default(cuid())
  promotionId     String
  promotion       Promotion @relation(fields: [promotionId], references: [id])
  userId          String
  user            User      @relation(fields: [userId], references: [id])
  orderId         String
  order           Order     @relation(fields: [orderId], references: [id])
  discountApplied Decimal   @db.Decimal(10, 2)
  createdAt       DateTime  @default(now())
}

enum PromotionType {
  CODE
  AUTO
}

enum DiscountType {
  PERCENTAGE
  FIXED_AMOUNT
  FREE_SHIPPING
}
```

### Côté admin — `/admin/promotions`

- Liste : nom, type (badge CODE/AUTO), code, réduction, dates, utilisations/max, statut
- Création/édition (formulaire complet) :
  - Type : Code promo ou Automatique
  - Code (si CODE) : saisie manuelle ou génération aléatoire
  - Réduction : pourcentage / montant fixe / livraison gratuite
  - Conditions : montant min, max utilisations (total + par client), première commande
  - Ciblage : tous produits OU sélection catégories / collections / produits
  - Dates : début (obligatoire) + fin (optionnel)
- Activer/désactiver une promo
- Stats : utilisations, montant total de réductions

### Côté client — Panier

- Champ "Code promo" + bouton "Appliquer"
- Validation temps réel : code valide, conditions, expiration, max uses
- Ligne séparée dans le récap panier : "Réduction (CODE20) : -XX.XX €"
- Promotions AUTO : appliquées sans action, affichées "Promotion : [nom] — -XX.XX €"
- Ordre d'application : promotions d'abord, avoirs ensuite

### Logique serveur

- Validation complète au checkout (ne jamais faire confiance au client)
- Vérification : dates, conditions, max uses, ciblage, stock
- `PromotionUsage` créé à la confirmation de commande
- Si commande annulée : `PromotionUsage` supprimé, `currentUses` décrémenté

---

## 6. Statistiques produit (tab admin)

### Nouveau tab "Statistiques" dans la page produit admin

**Cards KPI (haut de page) :**
- Chiffre d'affaires total
- Quantité totale vendue
- Nombre de commandes contenant ce produit
- Actuellement dans X paniers
- Nombre de vues (page produit)
- Nombre de réclamations SAV

**Graphiques (Recharts, CSS variables pour dark mode) :**
- Ventes par mois — 12 derniers mois (barres : CA + quantité)
- Répartition par couleur/variante (donut)
- Répartition par taille (bar horizontal)

**Tableaux :**
- Top clients (entreprise, quantité, CA)
- Historique des prix (date, ancien prix, nouveau prix, admin)

### Tracking des vues

```prisma
model ProductView {
  id        String   @id @default(cuid())
  productId String
  product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  userId    String?
  user      User?    @relation(fields: [userId], references: [id])
  sessionId String
  createdAt DateTime @default(now())

  @@index([productId, sessionId, createdAt])
}
```

- Incrémenté côté serveur au chargement de la page produit
- Dédupliqué : max 1 vue par session par heure

### Historique des prix

```prisma
model PriceHistory {
  id             String       @id @default(cuid())
  productColorId String
  productColor   ProductColor @relation(fields: [productColorId], references: [id], onDelete: Cascade)
  field          String       // "unitPrice" | "discountPrice"
  oldPrice       Decimal      @db.Decimal(10, 2)
  newPrice       Decimal      @db.Decimal(10, 2)
  changedById    String
  changedBy      User         @relation(fields: [changedById], references: [id])
  createdAt      DateTime     @default(now())

  @@index([productColorId, createdAt])
}
```

- Enregistré automatiquement quand `unitPrice` ou `discountPrice` change sur ProductColor

---

## 7. Dashboard client enrichi + recommander à nouveau

### Améliorations dashboard espace pro

**Timeline commande :**
- Sur les commandes récentes : barre horizontale `Confirmée → En traitement → Expédiée → Livrée`
- Étape active colorée, les autres grisées
- Responsive : vertical sur mobile

**Facture PDF :**
- Bouton "Télécharger la facture" sur chaque commande (>= PROCESSING)
- Génération pdfkit à la volée, même style que factures admin
- Endpoint : `/api/orders/[id]/invoice`

**Section "Mes avoirs" :**
- Si avoirs disponibles : carte avec solde total + liste détaillée
- Montant, date, réclamation liée, solde restant, date d'expiration

### Recommander à nouveau

- Bouton "Commander à nouveau" sur chaque commande (liste + détail)
- Action serveur :
  - Vérifie chaque article : disponible (ONLINE), stock suffisant
  - Si produit indisponible (ARCHIVED/OFFLINE) → exclu avec avertissement
  - Si stock insuffisant → quantité réduite au max disponible avec avertissement
- Si panier non vide → dialog de confirmation : "Remplacer le panier ou fusionner ?"
- Feedback toast avec résumé (X articles ajoutés, Y indisponibles)

---

## Contraintes techniques transversales

- **Responsive** : toutes les UIs mobile-first, touch targets min 44px
- **Dark mode admin** : utiliser variables CSS (`bg-bg-primary`, `text-text-primary`, `border-border`). Pour Recharts/inline : `var(--color-bg-primary)` etc.
- **Server actions** : `requireAdmin()` / `requireAuth()` obligatoire
- **Cache** : `getCached*` + `revalidateTag(tag, "default")` (2 args Next 16)
- **Prisma 5.22** : pas v7
- **Zod v4** : `.issues` pas `.errors`
- **UI** : `useConfirm()`, `useToast()`, `CustomSelect`, `badge badge-*`
- **Images** : upload R2 via `lib/r2.ts`, `processProductImage()` pour images produit
- **Emails** : `lib/gmail.ts` existant
- **Easy Express** : `lib/easy-express.ts` existant pour bordereau/expédition
- **Logging** : `logger.info/warn/error()` jamais `console.*`
