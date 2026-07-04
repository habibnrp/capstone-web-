from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('monitoring', '0003_merge_0002_add_monitoringuser_0002_monitoringuser'),
    ]

    operations = [
        migrations.CreateModel(
            name='SystemSetting',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('key', models.CharField(max_length=100, unique=True)),
                ('value', models.TextField(blank=True, default='')),
            ],
        ),
    ]
