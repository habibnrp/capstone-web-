from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('monitoring', '0005_add_user_role'),
    ]

    operations = [
        migrations.CreateModel(
            name='SignupOTP',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('email', models.CharField(max_length=254, unique=True)),
                ('password_hash', models.CharField(max_length=255)),
                ('otp_hash', models.CharField(max_length=255)),
                ('expires_at', models.DateTimeField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
        ),
    ]
