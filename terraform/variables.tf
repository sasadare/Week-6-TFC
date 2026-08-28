variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-south-1"
}

variable "project_name" {
  description = "Project name prefix"
  type        = string
  default     = "week6-validator"
}

variable "tags" {
  description = "Resource tags"
  type        = map(string)
  default = {
    Project     = "NGDE-Week6"
    Environment = "dev"
    Owner       = "sasadare"
    ManagedBy   = "terraform"
  }
}
