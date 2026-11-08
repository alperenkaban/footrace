import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class BuyPackageDto {
  @IsString()
  @IsNotEmpty()
  packageId: string;

  @IsOptional()
  @IsString()
  userId?: string;
}

export class ClaimAdRewardDto {
  @IsOptional()
  @IsString()
  userId?: string;
}

export class VerifyGooglePlayDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsNotEmpty()
  purchaseToken: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  userId?: string;
}

export class VerifyAppleAppStoreDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsNotEmpty()
  transactionId: string;

  @IsOptional()
  @IsString()
  receiptData?: string;

  @IsOptional()
  @IsString()
  userId?: string;
}

export class RestorePurchasesDto {
  @IsOptional()
  @IsString()
  userId?: string;
}

